import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawUnsafeMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRawUnsafe: queryRawUnsafeMock,
  },
}));

function createDeferred<T>() {
  let resolve: ((value: T) => void) | null = null;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("interactive table counts", () => {
  beforeEach(async () => {
    vi.resetModules();
    queryRawUnsafeMock.mockReset();
  });

  it("reuses exact count within TTL", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);

    const exactCount = vi.fn().mockResolvedValue(321);
    queryRawUnsafeMock.mockResolvedValue([]);

    const { clearInteractiveTableCountCache, getInteractiveTableCount } = await import("@/lib/interactive-table-counts");
    clearInteractiveTableCountCache();

    const first = await getInteractiveTableCount({
      cacheKey: "videos",
      tableName: "videos",
      fallback: 0,
      exactCount,
    });
    const second = await getInteractiveTableCount({
      cacheKey: "videos",
      tableName: "videos",
      fallback: 0,
      exactCount,
    });

    expect(first).toBe(321);
    expect(second).toBe(321);
    expect(exactCount).toHaveBeenCalledTimes(1);
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
  });

  it("returns stale exact count immediately while background exact refresh runs", async () => {
    const nowSpy = vi.spyOn(Date, "now");

    const exactDeferred = createDeferred<number>();
    const exactCount = vi
      .fn()
      .mockResolvedValueOnce(200)
      .mockImplementationOnce(() => exactDeferred.promise);
    queryRawUnsafeMock.mockResolvedValue([]);

    const {
      INTERACTIVE_TABLE_COUNT_EXACT_TTL_MS,
      clearInteractiveTableCountCache,
      getInteractiveTableCount,
    } = await import("@/lib/interactive-table-counts");

    clearInteractiveTableCountCache();

    nowSpy.mockReturnValue(10_000);
    const initial = await getInteractiveTableCount({
      cacheKey: "artists",
      tableName: "artists",
      fallback: 0,
      exactCount,
    });

    nowSpy.mockReturnValue(10_000 + INTERACTIVE_TABLE_COUNT_EXACT_TTL_MS + 1);
    const stale = await getInteractiveTableCount({
      cacheKey: "artists",
      tableName: "artists",
      fallback: 0,
      exactCount,
    });

    expect(initial).toBe(200);
    expect(stale).toBe(200);
    expect(exactCount).toHaveBeenCalledTimes(2);

    exactDeferred.resolve?.(240);
    await Promise.resolve();

    const refreshed = await getInteractiveTableCount({
      cacheKey: "artists",
      tableName: "artists",
      fallback: 0,
      exactCount,
    });

    expect(refreshed).toBe(240);
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
  });

  it("uses approximate count first and refreshes exact count in background", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(50_000);

    const exactDeferred = createDeferred<number>();
    const exactCount = vi.fn().mockImplementationOnce(() => exactDeferred.promise);

    queryRawUnsafeMock.mockResolvedValueOnce([{ tableRows: 876 }]);

    const { clearInteractiveTableCountCache, getInteractiveTableCount } = await import("@/lib/interactive-table-counts");
    clearInteractiveTableCountCache();

    const approxFirst = await getInteractiveTableCount({
      cacheKey: "videos",
      tableName: "videos",
      fallback: 0,
      exactCount,
    });

    expect(approxFirst).toBe(876);
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(1);

    exactDeferred.resolve?.(900);
    await Promise.resolve();

    const exactLater = await getInteractiveTableCount({
      cacheKey: "videos",
      tableName: "videos",
      fallback: 0,
      exactCount,
    });

    expect(exactLater).toBe(900);

    nowSpy.mockRestore();
  });
});
