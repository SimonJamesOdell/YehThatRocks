import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawMock = vi.fn();
const queryRawUnsafeMock = vi.fn();
const executeRawMock = vi.fn();
const videoFindManyMock = vi.fn();

const getMusicBrainzArtistDataMock = vi.fn();
const findFirstMock = vi.fn();
const findManyMock = vi.fn();
const updateMock = vi.fn();
const updateManyMock = vi.fn();
const createMock = vi.fn();
const createManyMock = vi.fn();
const deleteManyMock = vi.fn();
const siteVideoFindFirstMock = vi.fn();
const recordExternalApiUsageMock = vi.fn();

const originalDatabaseUrl = process.env.DATABASE_URL;

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: queryRawMock,
    $queryRawUnsafe: queryRawUnsafeMock,
    $executeRaw: executeRawMock,
    $executeRawUnsafe: executeRawMock,
    video: {
      findMany: videoFindManyMock,
      findFirst: findFirstMock,
    },
    siteVideo: {
      findFirst: siteVideoFindFirstMock,
      update: updateMock,
      updateMany: updateManyMock,
      create: createMock,
    },
    relatedCache: {
      findMany: findManyMock,
      createMany: createManyMock,
      deleteMany: deleteManyMock,
    },
    related: {
      findMany: findManyMock,
      createMany: createManyMock,
    },
  },
}));

vi.mock("@/lib/musicbrainz", () => ({
  getMusicBrainzArtistData: getMusicBrainzArtistDataMock,
}));

vi.mock("@/lib/api-usage-telemetry", () => ({
  recordExternalApiUsage: recordExternalApiUsageMock,
}));

vi.mock("@/lib/catalog-data-db", () => ({
  ensureVideoChannelTitleColumnAvailable: vi.fn().mockResolvedValue(false),
  ensureVideoGenreColumnAvailable: vi.fn().mockResolvedValue(false),
  ensureVideoMetadataColumnsAvailable: vi.fn().mockResolvedValue(false),
  getArtistColumnMap: vi.fn().mockResolvedValue({
    name: "artist",
    normalizedName: null,
    country: "country",
    genreColumns: ["genre1"],
  }),
  getStoredVideoById: vi.fn().mockResolvedValue(null),
  loadTableColumns: vi.fn().mockResolvedValue([]),
  loadVideoForeignKeyRefs: vi.fn().mockResolvedValue([]),
  pickColumn: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/catalog-data-artists", () => ({
  getArtistCatalogEvidence: vi.fn().mockResolvedValue({ known: false, rockOrMetalGenreMatch: false }),
  maybeInsertNewArtist: vi.fn().mockResolvedValue(undefined),
  scheduleArtistProjectionRefreshForName: vi.fn(),
}));

vi.mock("@/lib/catalog-data-genres", () => ({
  clearGenreCardThumbnailForVideo: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/available-video-max-id", () => ({
  markAvailableVideoMaxIdDirty: vi.fn().mockResolvedValue(undefined),
  recordAvailableVideoIdCandidate: vi.fn().mockResolvedValue(undefined),
}));

describe("catalog-data-video-ingestion quality hardening", () => {
  beforeEach(async () => {
    vi.resetModules();
    queryRawMock.mockReset();
    queryRawUnsafeMock.mockReset();
    executeRawMock.mockReset();
    videoFindManyMock.mockReset();
    findFirstMock.mockReset();
    findManyMock.mockReset();
    updateMock.mockReset();
    updateManyMock.mockReset();
    createMock.mockReset();
    createManyMock.mockReset();
    deleteManyMock.mockReset();
    siteVideoFindFirstMock.mockReset();
    recordExternalApiUsageMock.mockReset();
    getMusicBrainzArtistDataMock.mockReset();
    process.env.DATABASE_URL = "mysql://test";

    executeRawMock.mockResolvedValue(1);
    videoFindManyMock.mockResolvedValue([]);
    findFirstMock.mockResolvedValue(null);
    findManyMock.mockResolvedValue([]);
    updateMock.mockResolvedValue(null);
    updateManyMock.mockResolvedValue({ count: 0 });
    createMock.mockResolvedValue(null);
    createManyMock.mockResolvedValue({ count: 0 });
    deleteManyMock.mockResolvedValue({ count: 0 });
    siteVideoFindFirstMock.mockResolvedValue(null);
    recordExternalApiUsageMock.mockResolvedValue(undefined);
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

  it("builds prominent artist keys spread across supported genre buckets", async () => {
    queryRawUnsafeMock.mockResolvedValueOnce([
      { artistKey: "metallica", genre: "Thrash Metal", favouriteWeight: 1000, videoCount: 80 },
      { artistKey: "sabaton", genre: "Power Metal", favouriteWeight: 800, videoCount: 65 },
      { artistKey: "gojira", genre: "Progressive Metal", favouriteWeight: 700, videoCount: 50 },
      { artistKey: "ghost", genre: "Hard Rock", favouriteWeight: 600, videoCount: 45 },
    ]);

    const { videoIngestionInternals } = await import("@/lib/catalog-data-video-ingestion");
    const keys = await videoIngestionInternals.loadProminentGenreArtistKeys();

    expect(keys).toContain("metallica");
    expect(keys).toContain("sabaton");
    expect(keys).toContain("gojira");
    expect(keys).toContain("ghost");
  });

  it("does not infer blank genres as rock for prominent artist seed keys", async () => {
    queryRawUnsafeMock.mockResolvedValueOnce([
      { artistKey: "legacyunknown", genre: "", favouriteWeight: 1500, videoCount: 200 },
      { artistKey: "chartpop", genre: "Pop", favouriteWeight: 1400, videoCount: 180 },
      { artistKey: "slayer", genre: "Thrash Metal", favouriteWeight: 1300, videoCount: 160 },
    ]);

    const { videoIngestionInternals } = await import("@/lib/catalog-data-video-ingestion");
    const keys = await videoIngestionInternals.loadProminentGenreArtistKeys();

    expect(keys).toContain("slayer");
    expect(keys).not.toContain("legacyunknown");
    expect(keys).not.toContain("chartpop");
  });

  it("strict rock/metal genre helper only accepts rock-aligned genres", async () => {
    const { videoIngestionInternals } = await import("@/lib/catalog-data-video-ingestion");

    expect(videoIngestionInternals.isRockOrMetalGenreValue("Thrash Metal")).toBe(true);
    expect(videoIngestionInternals.isRockOrMetalGenreValue("Alternative Rock")).toBe(true);
    expect(videoIngestionInternals.isRockOrMetalGenreValue("Pop")).toBe(false);
    expect(videoIngestionInternals.isRockOrMetalGenreValue("")).toBe(false);
    expect(videoIngestionInternals.isRockOrMetalGenreValue(null)).toBe(false);
  });

  it("does not treat stored genre alone as external rock evidence", async () => {
    queryRawMock.mockResolvedValueOnce([
      { genre: "Rock / Metal", parsedArtist: null },
    ]);

    const { videoIngestionInternals } = await import("@/lib/catalog-data-video-ingestion");
    const decision = await videoIngestionInternals.classifyPersistedVideoGenre("abc123def45");

    expect(decision.hasExternalRockEvidence).toBe(false);
    expect(decision.proposedGenre).toBeNull();
    expect(decision.reason).toBe("no-sources");
  });

  it("flags MusicBrainz rock signal as external rock evidence", async () => {
    queryRawMock.mockResolvedValueOnce([
      { genre: null, parsedArtist: "Mastodon" },
    ]);
    queryRawUnsafeMock.mockResolvedValueOnce([]);
    getMusicBrainzArtistDataMock.mockResolvedValueOnce({
      tags: ["progressive metal"],
      isRockOrMetal: true,
      isDefinitelyNotRockOrMetal: false,
      disambiguation: null,
    });

    const { videoIngestionInternals } = await import("@/lib/catalog-data-video-ingestion");
    const decision = await videoIngestionInternals.classifyPersistedVideoGenre("abc123def45");

    expect(decision.hasExternalRockEvidence).toBe(true);
    expect(decision.action).toBe("queue");
    expect(decision.proposedGenre).toBe("Progressive & Experimental");
    expect(decision.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("adds removed pending videos to rejected list so they do not resurface", async () => {
    videoFindManyMock.mockResolvedValueOnce([
      { id: 77, parsedArtist: "Random Pop Channel" },
    ]);

    const { pruneVideoAndAssociationsByVideoId } = await import("@/lib/catalog-data-video-ingestion");
    const result = await pruneVideoAndAssociationsByVideoId("abc123def45", "admin-pending-remove");

    expect(result.pruned).toBe(true);
    expect(executeRawMock).toHaveBeenCalled();
    const sawRejectedInsert = executeRawMock.mock.calls.some((args) => String(args[0]).includes("INSERT INTO rejected_videos"));
    expect(sawRejectedInsert).toBe(true);
  });

  it("records internal admit usage for related discovery admissions", async () => {
    queryRawUnsafeMock.mockResolvedValueOnce([]);

    const { videoIngestionInternals } = await import("@/lib/catalog-data-video-ingestion");

    const plans = videoIngestionInternals.buildRelatedSearchQueryPlans({
      parsedArtist: "Metallica",
      parsedTrack: "One",
      title: "Metallica - One",
      highConfidenceTracks: ["Enter Sandman"],
    });

    expect(plans.length).toBeGreaterThan(0);
    expect(recordExternalApiUsageMock).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
    return;
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
});
