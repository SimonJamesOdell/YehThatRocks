import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawUnsafeMock = vi.fn();
const executeRawMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRawUnsafe: queryRawUnsafeMock,
    $executeRaw: executeRawMock,
  },
}));

vi.mock("@/lib/catalog-metadata-utils", () => ({
  inferArtistFromTitle: vi.fn().mockReturnValue(null),
}));

describe("fetchRandomCatalogVideosForCurrentVideo", () => {
  beforeEach(() => {
    vi.resetModules();
    queryRawUnsafeMock.mockReset();
    executeRawMock.mockReset();
  });

  it("returns empty array when pool is empty", async () => {
    const { fetchRandomCatalogVideosForCurrentVideo } = await import("@/lib/current-video-route-service");

    const result = await fetchRandomCatalogVideosForCurrentVideo({
      currentVideoId: "vid001",
      count: 10,
      getRandomVideoIdPool: async () => [],
      genericArtistLabels: new Set(),
    });

    expect(result).toEqual([]);
    expect(queryRawUnsafeMock).not.toHaveBeenCalled();
  });

  it("excludes current video ID from results", async () => {
    const { fetchRandomCatalogVideosForCurrentVideo } = await import("@/lib/current-video-route-service");

    // Pool contains the current video alongside others
    const pool = ["vid001", "vid002", "vid003"];

    queryRawUnsafeMock.mockResolvedValueOnce([
      { dbId: 2, id: "vid002", title: "Track B", channelTitle: "Band B", favourited: 0, description: null },
      { dbId: 3, id: "vid003", title: "Track C", channelTitle: "Band C", favourited: 0, description: null },
    ]);

    const result = await fetchRandomCatalogVideosForCurrentVideo({
      currentVideoId: "vid001",
      count: 5,
      getRandomVideoIdPool: async () => pool,
      genericArtistLabels: new Set(),
    });

    expect(result.every((v) => v.id !== "vid001")).toBe(true);
  });

  it("fetches full video data from DB for selected pool IDs", async () => {
    const { fetchRandomCatalogVideosForCurrentVideo } = await import("@/lib/current-video-route-service");

    const pool = ["vid002", "vid003", "vid004"];

    queryRawUnsafeMock.mockResolvedValueOnce([
      { dbId: 2, id: "vid002", title: "Rock Anthem", channelTitle: "Iron Band", favourited: 5, description: "heavy riff" },
    ]);

    const result = await fetchRandomCatalogVideosForCurrentVideo({
      currentVideoId: "vid999",
      count: 3,
      getRandomVideoIdPool: async () => pool,
      genericArtistLabels: new Set(),
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].id).toBe("vid002");
    expect(result[0].title).toBe("Rock Anthem");
    expect(result[0].channelTitle).toBe("Iron Band");
    expect(result[0].favourited).toBe(5);
    // Confirm DB query used IN clause with pool IDs
    const callArg: string = queryRawUnsafeMock.mock.calls[0][0];
    expect(callArg).toMatch(/WHERE v\.videoId IN/i);
  });

  it("respects the requested count upper bound", async () => {
    const { fetchRandomCatalogVideosForCurrentVideo } = await import("@/lib/current-video-route-service");

    const pool = Array.from({ length: 100 }, (_, i) => `vid${String(i).padStart(3, "0")}`);

    // DB returns more than requested
    const dbRows = Array.from({ length: 50 }, (_, i) => ({
      dbId: i + 1,
      id: `vid${String(i).padStart(3, "0")}`,
      title: `Track ${i}`,
      channelTitle: `Artist ${i}`,
      favourited: 0,
      description: null,
    }));
    queryRawUnsafeMock.mockResolvedValueOnce(dbRows);

    const result = await fetchRandomCatalogVideosForCurrentVideo({
      currentVideoId: "vidNOT",
      count: 5,
      getRandomVideoIdPool: async () => pool,
      genericArtistLabels: new Set(),
    });

    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("returns empty array when all pool IDs are the current video", async () => {
    const { fetchRandomCatalogVideosForCurrentVideo } = await import("@/lib/current-video-route-service");

    const result = await fetchRandomCatalogVideosForCurrentVideo({
      currentVideoId: "vid001",
      count: 10,
      getRandomVideoIdPool: async () => ["vid001"],
      genericArtistLabels: new Set(),
    });

    expect(result).toEqual([]);
    expect(queryRawUnsafeMock).not.toHaveBeenCalled();
  });

  it("uses generic artist label fallback for unknown artists", async () => {
    const { fetchRandomCatalogVideosForCurrentVideo } = await import("@/lib/current-video-route-service");
    const { inferArtistFromTitle } = await import("@/lib/catalog-metadata-utils");
    vi.mocked(inferArtistFromTitle).mockReturnValue("Inferred Artist");

    queryRawUnsafeMock.mockResolvedValueOnce([
      { dbId: 1, id: "vid100", title: "Inferred Artist - Song Name", channelTitle: "youtube", favourited: 0, description: null },
    ]);

    const result = await fetchRandomCatalogVideosForCurrentVideo({
      currentVideoId: "vid999",
      count: 1,
      getRandomVideoIdPool: async () => ["vid100"],
      genericArtistLabels: new Set(["youtube", "unknown artist"]),
    });

    expect(result[0].channelTitle).toBe("Inferred Artist");
  });
});
