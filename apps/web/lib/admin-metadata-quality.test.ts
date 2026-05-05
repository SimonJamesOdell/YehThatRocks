import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────
const queryRawMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: queryRawMock },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_RESULT = [{ availableVideos: 200000n, checkFailedEntries: 1500n }];
const META_RESULT = [{ missingMetadata: 300n, lowConfidence: 4000n, unknownType: 800n }];

function mockQueryRaw() {
  queryRawMock
    .mockResolvedValueOnce(STATUS_RESULT)
    .mockResolvedValueOnce(META_RESULT);
}

// ── Tests ──────────────────────────────────────────────────────────────────────
describe("getMetadataQualityStats", () => {
  beforeEach(() => {
    vi.resetModules();
    queryRawMock.mockReset();
  });

  it("queries both tables and returns the combined stats", async () => {
    mockQueryRaw();
    const { getMetadataQualityStats, resetMetadataQualityCache } = await import("@/lib/admin-metadata-quality");
    resetMetadataQualityCache();

    const stats = await getMetadataQualityStats();

    expect(queryRawMock).toHaveBeenCalledTimes(2);
    expect(stats.availableVideos).toBe(200000);
    expect(stats.checkFailedEntries).toBe(1500);
    expect(stats.missingMetadata).toBe(300);
    expect(stats.lowConfidence).toBe(4000);
    expect(stats.unknownType).toBe(800);
  });

  it("uses the in-memory cache on a second call within TTL", async () => {
    mockQueryRaw();
    const { getMetadataQualityStats, resetMetadataQualityCache } = await import("@/lib/admin-metadata-quality");
    resetMetadataQualityCache();

    await getMetadataQualityStats();    // populates cache
    const second = await getMetadataQualityStats(); // should hit cache

    // Only 2 DB calls total (the first fetch's two parallel queries), not 4
    expect(queryRawMock).toHaveBeenCalledTimes(2);
    expect(second.availableVideos).toBe(200000);
  });

  it("re-queries when the cache has expired", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);

    mockQueryRaw();
    const { getMetadataQualityStats, resetMetadataQualityCache, METADATA_QUALITY_CACHE_TTL_MS } = await import("@/lib/admin-metadata-quality");
    resetMetadataQualityCache();

    await getMetadataQualityStats();

    // Jump past the TTL
    nowSpy.mockReturnValue(1_000_000 + METADATA_QUALITY_CACHE_TTL_MS + 1000);

    // Second call: simulate updated DB values
    queryRawMock
      .mockResolvedValueOnce([{ availableVideos: 210000n, checkFailedEntries: 1600n }])
      .mockResolvedValueOnce([{ missingMetadata: 310n, lowConfidence: 4100n, unknownType: 810n }]);

    const fresh = await getMetadataQualityStats();

    expect(queryRawMock).toHaveBeenCalledTimes(4); // 2 initial + 2 refresh
    expect(fresh.availableVideos).toBe(210000);

    nowSpy.mockRestore();
  });

  it("deduplicates concurrent in-flight requests to a single DB call", async () => {
    let resolveStatus!: (v: typeof STATUS_RESULT) => void;
    let resolveMeta!: (v: typeof META_RESULT) => void;

    queryRawMock
      .mockReturnValueOnce(new Promise<typeof STATUS_RESULT>((res) => { resolveStatus = res; }))
      .mockReturnValueOnce(new Promise<typeof META_RESULT>((res) => { resolveMeta = res; }));

    const { getMetadataQualityStats, resetMetadataQualityCache } = await import("@/lib/admin-metadata-quality");
    resetMetadataQualityCache();

    const [p1, p2, p3] = [
      getMetadataQualityStats(),
      getMetadataQualityStats(),
      getMetadataQualityStats(),
    ];

    resolveStatus(STATUS_RESULT);
    resolveMeta(META_RESULT);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(r1.availableVideos).toBe(200000);
    expect(r2.availableVideos).toBe(200000);
    expect(r3.availableVideos).toBe(200000);
    expect(queryRawMock).toHaveBeenCalledTimes(2);
  });

  it("returns zeros gracefully when DB queries throw", async () => {
    queryRawMock
      .mockRejectedValueOnce(new Error("DB down"))
      .mockRejectedValueOnce(new Error("DB down"));

    const { getMetadataQualityStats, resetMetadataQualityCache } = await import("@/lib/admin-metadata-quality");
    resetMetadataQualityCache();

    const stats = await getMetadataQualityStats();

    expect(stats.availableVideos).toBe(0);
    expect(stats.missingMetadata).toBe(0);
  });

  it("status query targets site_videos table", async () => {
    mockQueryRaw();
    const { getMetadataQualityStats, resetMetadataQualityCache } = await import("@/lib/admin-metadata-quality");
    resetMetadataQualityCache();

    await getMetadataQualityStats();

    const firstCallArg = queryRawMock.mock.calls[0][0];
    const sqlText = String(firstCallArg);
    expect(sqlText.toLowerCase()).toContain("site_videos");
    expect(sqlText.toLowerCase()).not.toContain("from videos");
  });

  it("metadata query targets videos table for quality columns", async () => {
    mockQueryRaw();
    const { getMetadataQualityStats, resetMetadataQualityCache } = await import("@/lib/admin-metadata-quality");
    resetMetadataQualityCache();

    await getMetadataQualityStats();

    const secondCallArg = queryRawMock.mock.calls[1][0];
    const sqlText = String(secondCallArg);
    expect(sqlText.toLowerCase()).toContain("from videos");
    expect(sqlText).toContain("parsedArtist");
    expect(sqlText).toContain("parseConfidence");
  });

  it("TTL is at least 10 minutes", async () => {
    const { METADATA_QUALITY_CACHE_TTL_MS } = await import("@/lib/admin-metadata-quality");
    expect(METADATA_QUALITY_CACHE_TTL_MS).toBeGreaterThanOrEqual(10 * 60 * 1000);
  });
});
