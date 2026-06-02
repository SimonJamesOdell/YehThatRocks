import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawMock = vi.fn();
const queryRawUnsafeMock = vi.fn();
const executeRawMock = vi.fn();

const getMusicBrainzArtistDataMock = vi.fn();

const originalDatabaseUrl = process.env.DATABASE_URL;

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: queryRawMock,
    $queryRawUnsafe: queryRawUnsafeMock,
    $executeRaw: executeRawMock,
  },
}));

vi.mock("@/lib/musicbrainz", () => ({
  getMusicBrainzArtistData: getMusicBrainzArtistDataMock,
}));

describe("catalog-data-video-ingestion quality hardening", () => {
  beforeEach(async () => {
    vi.resetModules();
    queryRawMock.mockReset();
    queryRawUnsafeMock.mockReset();
    executeRawMock.mockReset();
    getMusicBrainzArtistDataMock.mockReset();
    process.env.DATABASE_URL = "mysql://test";
  });

  it("builds related search plans with high-confidence seeded tracks", async () => {
    const { videoIngestionInternals } = await import("@/lib/catalog-data-video-ingestion");

    const plans = videoIngestionInternals.buildRelatedSearchQueryPlans({
      parsedArtist: "Mastodon",
      parsedTrack: "Blood and Thunder",
      title: "Mastodon - Blood and Thunder",
      highConfidenceTracks: ["The Motherload", "The Motherload", "Oblivion"],
    });

    expect(plans.length).toBeGreaterThan(0);
    expect(plans.length).toBeLessThanOrEqual(5);
    expect(plans.some((plan) => plan.intent === "artist-track-official")).toBe(true);
    expect(plans.some((plan) => plan.query.toLowerCase().includes("the motherload"))).toBe(true);
  });

  it("scores non-overlap non-music candidates far below artist+track overlap candidates", async () => {
    const { videoIngestionInternals } = await import("@/lib/catalog-data-video-ingestion");

    const strong = videoIngestionInternals.scoreRelatedSearchCandidate(
      {
        title: "Metallica - Master of Puppets (Official Music Video)",
        channelTitle: "MetallicaTV",
        description: "Official music video for Master of Puppets by Metallica.",
      },
      { parsedArtist: "Metallica", parsedTrack: "Master of Puppets" },
      "artist-track-official",
    );

    const weak = videoIngestionInternals.scoreRelatedSearchCandidate(
      {
        title: "Podcast reaction to random pop chart news",
        channelTitle: "Talk Show Daily",
        description: "Interview, reaction, and shorts compilation.",
      },
      { parsedArtist: "Metallica", parsedTrack: "Master of Puppets" },
      "artist-track-official",
    );

    expect(strong).toBeGreaterThan(2);
    expect(weak).toBeLessThan(0);
    expect(strong - weak).toBeGreaterThan(2.5);
  });

  it("auto-removes when external signals are confidently non-rock", async () => {
    queryRawMock.mockResolvedValueOnce([
      { genre: null, parsedArtist: "Taylor Swift" },
    ]);
    queryRawUnsafeMock.mockResolvedValueOnce([
      { genre: "Pop" },
    ]);
    getMusicBrainzArtistDataMock.mockResolvedValueOnce({
      tags: ["pop"],
      isRockOrMetal: false,
      isDefinitelyNotRockOrMetal: true,
      disambiguation: null,
    });

    const { videoIngestionInternals } = await import("@/lib/catalog-data-video-ingestion");
    const decision = await videoIngestionInternals.classifyPersistedVideoGenre("abc123def45");

    expect(decision.action).toBe("remove");
    expect(decision.reason).toContain("genre-auto-remove");
    expect(decision.proposedGenre?.toLowerCase()).toContain("pop");
    expect(decision.confidence).toBeGreaterThanOrEqual(0.86);
  });

  it("keeps queue manual when only existing video genre is available", async () => {
    queryRawMock.mockResolvedValueOnce([
      { genre: "Pop", parsedArtist: null },
    ]);

    const { videoIngestionInternals } = await import("@/lib/catalog-data-video-ingestion");
    const decision = await videoIngestionInternals.classifyPersistedVideoGenre("abc123def45");

    expect(decision.action).toBe("queue");
    expect(decision.reason).toBe("genre-manual-review:insufficient-external-sources");
  });
});

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
    return;
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
});
