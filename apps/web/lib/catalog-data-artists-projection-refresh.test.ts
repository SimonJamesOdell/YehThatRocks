/**
 * Tests for the DB-side freshness check and COUNT optimisation in
 * refreshArtistProjectionForName.
 *
 * Key invariants:
 *  – When artist_stats.updated_at is within ARTIST_PROJECTION_REFRESH_TTL_MS,
 *    the heavy COUNT + thumbnail queries are skipped entirely.
 *  – When the row is stale or absent, the COUNT query uses COUNT(v.id) not
 *    COUNT(DISTINCT v.videoId) (the AVAILABLE_SITE_VIDEOS_JOIN already dedupes).
 *  – When videoCount drops to 0 the row is deleted from artist_stats.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawUnsafeMock = vi.fn();
const executeRawUnsafeMock = vi.fn();
const hasArtistStatsProjectionMock = vi.fn();
const hasArtistStatsThumbnailColumnMock = vi.fn();
const getVideoArtistNormalizationColumnMock = vi.fn();
const getVideoArtistNormalizationIndexHintClauseMock = vi.fn();
const getArtistColumnMapMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRawUnsafe: queryRawUnsafeMock,
    $executeRawUnsafe: executeRawUnsafeMock,
  },
}));

vi.mock("@/lib/catalog-data-db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/catalog-data-db")>("@/lib/catalog-data-db");
  return {
    ...actual,
    hasArtistStatsProjection: hasArtistStatsProjectionMock,
    hasArtistStatsThumbnailColumn: hasArtistStatsThumbnailColumnMock,
    getVideoArtistNormalizationColumn: getVideoArtistNormalizationColumnMock,
    getVideoArtistNormalizationIndexHintClause: getVideoArtistNormalizationIndexHintClauseMock,
    getArtistColumnMap: getArtistColumnMapMock,
  };
});

function setupCommonMocks() {
  hasArtistStatsProjectionMock.mockResolvedValue(true);
  hasArtistStatsThumbnailColumnMock.mockResolvedValue(true);
  getVideoArtistNormalizationColumnMock.mockResolvedValue("parsedArtist");
  getVideoArtistNormalizationIndexHintClauseMock.mockResolvedValue("");
  getArtistColumnMapMock.mockResolvedValue({
    name: "artist",
    normalizedName: "artist_name_norm",
    country: "country",
    genreColumns: ["genre1"],
  });
  executeRawUnsafeMock.mockResolvedValue(undefined);
}

describe("refreshArtistProjectionForName", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "mysql://test:test@localhost/yeh");
    queryRawUnsafeMock.mockReset();
    executeRawUnsafeMock.mockReset();
    hasArtistStatsProjectionMock.mockReset();
    hasArtistStatsThumbnailColumnMock.mockReset();
    getVideoArtistNormalizationColumnMock.mockReset();
    getVideoArtistNormalizationIndexHintClauseMock.mockReset();
    getArtistColumnMapMock.mockReset();
    setupCommonMocks();
  });

  it("skips heavy count and thumbnail queries when artist_stats row is fresh", async () => {
    // Fresh row: updated_at within the 5-minute refresh TTL
    queryRawUnsafeMock.mockResolvedValueOnce([
      { updatedAt: new Date() },
    ]);

    const { clearArtistCaches, refreshArtistProjectionForName } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    await refreshArtistProjectionForName("Metallica");

    // Only the lightweight freshness-check query should have been issued
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(1);
    const [sql] = queryRawUnsafeMock.mock.calls[0] as [string];
    expect(sql).toContain("updated_at");
    expect(sql).toContain("artist_stats");
    // Confirm no COUNT query was sent
    const anyCountCall = queryRawUnsafeMock.mock.calls.some(([s]: [string]) => /\bCOUNT\b/i.test(s));
    expect(anyCountCall).toBe(false);
  });

  it("runs count and thumbnail queries when artist_stats row is stale", async () => {
    const staleDate = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago — older than 5 min TTL
    // Freshness check: row exists but stale
    queryRawUnsafeMock.mockResolvedValueOnce([{ updatedAt: staleDate }]);
    // COUNT query
    queryRawUnsafeMock.mockResolvedValueOnce([{ videoCount: 7 }]);
    // Thumbnail query
    queryRawUnsafeMock.mockResolvedValueOnce([{ thumbnailVideoId: "dQw4w9WgXcQ" }]);
    // Artist meta
    queryRawUnsafeMock.mockResolvedValueOnce([{ country: "US", genre: "Metal" }]);

    const { clearArtistCaches, refreshArtistProjectionForName } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    await refreshArtistProjectionForName("Metallica");

    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(4);
    // Confirm the upsert path was triggered
    expect(executeRawUnsafeMock).toHaveBeenCalled();
  });

  it("uses COUNT(v.id) not COUNT(DISTINCT v.videoId) in count query", async () => {
    // No existing row — forces the full refresh path
    queryRawUnsafeMock.mockResolvedValueOnce([]);
    queryRawUnsafeMock.mockResolvedValueOnce([{ videoCount: 3 }]);
    queryRawUnsafeMock.mockResolvedValueOnce([{ thumbnailVideoId: "abc123" }]);
    queryRawUnsafeMock.mockResolvedValueOnce([{ country: null, genre: null }]);

    const { clearArtistCaches, refreshArtistProjectionForName } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    await refreshArtistProjectionForName("Iron Maiden");

    const countCall = queryRawUnsafeMock.mock.calls.find(([s]: [string]) => /\bCOUNT\b/i.test(s));
    expect(countCall).toBeDefined();
    const [countSql] = countCall as [string];
    expect(countSql).toContain("COUNT(v.id)");
    expect(countSql).not.toContain("COUNT(DISTINCT");
  });

  it("runs count query when no artist_stats row exists", async () => {
    queryRawUnsafeMock.mockResolvedValueOnce([]);
    queryRawUnsafeMock.mockResolvedValueOnce([{ videoCount: 5 }]);
    queryRawUnsafeMock.mockResolvedValueOnce([{ thumbnailVideoId: "yt123" }]);
    queryRawUnsafeMock.mockResolvedValueOnce([{ country: "UK", genre: "Rock" }]);

    const { clearArtistCaches, refreshArtistProjectionForName } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    await refreshArtistProjectionForName("Black Sabbath");

    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(4);
    expect(executeRawUnsafeMock).toHaveBeenCalled();
  });

  it("deletes artist_stats row when no available videos remain", async () => {
    // No existing row
    queryRawUnsafeMock.mockResolvedValueOnce([]);
    // COUNT = 0
    queryRawUnsafeMock.mockResolvedValueOnce([{ videoCount: 0 }]);
    // Thumbnail (parallel with count — resolves but unused since count = 0)
    queryRawUnsafeMock.mockResolvedValueOnce([]);

    const { clearArtistCaches, refreshArtistProjectionForName } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    await refreshArtistProjectionForName("Ghost Artist");

    const deleteCalls = executeRawUnsafeMock.mock.calls.filter(([s]: [string]) => /\bDELETE\b/i.test(s));
    expect(deleteCalls).toHaveLength(1);
  });
});
