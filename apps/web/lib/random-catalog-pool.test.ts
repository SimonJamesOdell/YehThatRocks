import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawUnsafeMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRawUnsafe: queryRawUnsafeMock,
  },
}));

vi.mock("@/lib/available-video-max-id", () => ({
  getAvailableVideoMaxId: vi.fn(),
}));

describe("getRandomCatalogPool", () => {
  beforeEach(async () => {
    vi.resetModules();
    queryRawUnsafeMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an array of video IDs built from probe queries", async () => {
    const { getAvailableVideoMaxId } = await import("@/lib/available-video-max-id");
    vi.mocked(getAvailableVideoMaxId).mockResolvedValue(100_000);

    // Each of the 8 probes returns some IDs
    queryRawUnsafeMock.mockResolvedValue([
      { videoId: "aaa" },
      { videoId: "bbb" },
      { videoId: "ccc" },
    ]);

    const { getRandomCatalogPool, resetRandomCatalogPool } = await import("@/lib/random-catalog-pool");
    resetRandomCatalogPool();

    const pool = await getRandomCatalogPool();

    expect(Array.isArray(pool)).toBe(true);
    expect(pool.length).toBeGreaterThan(0);
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(8);
  });

  it("returns empty array when maxId is 0", async () => {
    const { getAvailableVideoMaxId } = await import("@/lib/available-video-max-id");
    vi.mocked(getAvailableVideoMaxId).mockResolvedValue(0);

    const { getRandomCatalogPool, resetRandomCatalogPool } = await import("@/lib/random-catalog-pool");
    resetRandomCatalogPool();

    const pool = await getRandomCatalogPool();

    expect(pool).toEqual([]);
    expect(queryRawUnsafeMock).not.toHaveBeenCalled();
  });

  it("caches pool within TTL and skips rebuild", async () => {
    const { getAvailableVideoMaxId } = await import("@/lib/available-video-max-id");
    vi.mocked(getAvailableVideoMaxId).mockResolvedValue(100_000);

    queryRawUnsafeMock.mockResolvedValue([{ videoId: "abc" }]);

    const { getRandomCatalogPool, resetRandomCatalogPool, RANDOM_CATALOG_POOL_TTL_MS } = await import("@/lib/random-catalog-pool");
    resetRandomCatalogPool();

    const first = await getRandomCatalogPool();

    // Advance time but stay within TTL
    vi.advanceTimersByTime(RANDOM_CATALOG_POOL_TTL_MS - 1_000);

    queryRawUnsafeMock.mockReset();

    const second = await getRandomCatalogPool();

    // Pool was cached — DB not called again
    expect(queryRawUnsafeMock).not.toHaveBeenCalled();
    expect(second).toBe(first); // same reference
  });

  it("rebuilds pool after TTL expires", async () => {
    const { getAvailableVideoMaxId } = await import("@/lib/available-video-max-id");
    vi.mocked(getAvailableVideoMaxId).mockResolvedValue(100_000);

    queryRawUnsafeMock.mockResolvedValue([{ videoId: "abc" }]);

    const { getRandomCatalogPool, resetRandomCatalogPool, RANDOM_CATALOG_POOL_TTL_MS } = await import("@/lib/random-catalog-pool");
    resetRandomCatalogPool();

    await getRandomCatalogPool();

    // Advance past TTL
    vi.advanceTimersByTime(RANDOM_CATALOG_POOL_TTL_MS + 1_000);

    queryRawUnsafeMock.mockReset();
    queryRawUnsafeMock.mockResolvedValue([{ videoId: "def" }]);

    await getRandomCatalogPool();

    // DB was called again to rebuild the pool
    expect(queryRawUnsafeMock).toHaveBeenCalled();
  });

  it("deduplicates IDs returned by multiple probes", async () => {
    const { getAvailableVideoMaxId } = await import("@/lib/available-video-max-id");
    vi.mocked(getAvailableVideoMaxId).mockResolvedValue(100_000);

    // Every probe returns the same ID — must be deduped to one entry
    queryRawUnsafeMock.mockResolvedValue([{ videoId: "dupe" }]);

    const { getRandomCatalogPool, resetRandomCatalogPool } = await import("@/lib/random-catalog-pool");
    resetRandomCatalogPool();

    const pool = await getRandomCatalogPool();

    const dupeCount = (pool as readonly string[]).filter((id) => id === "dupe").length;
    expect(dupeCount).toBe(1);
  });

  it("coalesces concurrent in-flight requests into one DB round-trip", async () => {
    const { getAvailableVideoMaxId } = await import("@/lib/available-video-max-id");
    vi.mocked(getAvailableVideoMaxId).mockResolvedValue(100_000);

    let resolveProbe: (() => void) | null = null;
    const probePromise = new Promise<Array<{ videoId: string }>>((resolve) => {
      resolveProbe = () => resolve([{ videoId: "xyz" }]);
    });

    queryRawUnsafeMock.mockReturnValue(probePromise);

    const { getRandomCatalogPool, resetRandomCatalogPool } = await import("@/lib/random-catalog-pool");
    resetRandomCatalogPool();

    const p1 = getRandomCatalogPool();
    const p2 = getRandomCatalogPool();

    resolveProbe?.();

    const [r1, r2] = await Promise.all([p1, p2]);

    // Both callers got the same result
    expect(r1).toBe(r2);
    // Only 8 probe queries should fire (1 pool build), not 16 (2 independent builds)
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(8);
  });
});
