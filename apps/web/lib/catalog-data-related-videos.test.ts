import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawMock = vi.fn();
const queryRawUnsafeMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: queryRawMock,
    $queryRawUnsafe: queryRawUnsafeMock,
  },
}));

vi.mock("@/lib/catalog-data-artists", async () => {
  const actual = await vi.importActual<typeof import("@/lib/catalog-data-artists")>("@/lib/catalog-data-artists");
  return {
    ...actual,
    getArtistVideoPoolByNormalizedName: vi.fn().mockResolvedValue([]),
    getSameGenreRelatedPoolByArtist: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@/lib/catalog-data-favourites", () => ({
  fetchFavouriteVideoIds: vi.fn().mockResolvedValue(new Set<string>()),
  getFavouriteVideosInternal: vi.fn(),
  getFavouriteVideos: vi.fn(),
}));

vi.mock("@/lib/catalog-data-history", () => ({
  fetchRecentlyWatchedIds: vi.fn().mockResolvedValue(new Set<string>()),
  getSeenVideoIdsForUser: vi.fn(),
}));

vi.mock("@/lib/search-flag-data", () => ({
  getSearchRankingSignals: vi.fn().mockResolvedValue({
    suppressedVideoIds: new Set<string>(),
    penaltyByVideoId: new Map<string, number>(),
  }),
}));

describe("getRelatedVideos direct query shape", () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "mysql://test:test@localhost:3306/yeh";
    queryRawMock.mockReset();
    queryRawUnsafeMock.mockReset();

    queryRawMock.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join(" ").replace(/\s+/g, " ").trim();

      if (sql.includes("SELECT parsedArtist FROM videos WHERE videoId =")) {
        return Promise.resolve([{ parsedArtist: null }]);
      }

      return Promise.resolve([]);
    });

    queryRawUnsafeMock.mockResolvedValue([]);
  });

  it("uses EXISTS availability filtering for direct related videos", async () => {
    const { clearVideosCaches, getRelatedVideos } = await import("@/lib/catalog-data-videos");
    clearVideosCaches();

    await getRelatedVideos("ABCDEFGHIJK", { count: 5 });

    const directCall = queryRawUnsafeMock.mock.calls.find((call) => {
      const sql = call[0];
      return typeof sql === "string" && sql.includes("FROM related r");
    });

    expect(directCall).toBeDefined();

    const [sql, param] = directCall as [string, string];
    expect(param).toBe("ABCDEFGHIJK");
    expect(sql).toContain("FROM related r");
    expect(sql).toContain("INNER JOIN videos v ON v.videoId = r.related");
    expect(sql).toContain("EXISTS (");
    expect(sql).toContain("FROM site_videos sv");
    expect(sql).toContain("sv.video_id = v.id");
    expect(sql).toContain("sv.status = 'available'");
    expect(sql).not.toContain("SELECT DISTINCT sv.video_id");
    expect(sql).not.toContain("available_sv");
  });
});