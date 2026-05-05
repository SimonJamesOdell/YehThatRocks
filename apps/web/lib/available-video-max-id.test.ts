import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawMock = vi.fn();
const executeRawMock = vi.fn();
const executeRawUnsafeMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: queryRawMock,
    $executeRaw: executeRawMock,
    $executeRawUnsafe: executeRawUnsafeMock,
  },
}));

describe("available video max id metadata", () => {
  beforeEach(async () => {
    vi.resetModules();
    queryRawMock.mockReset();
    executeRawMock.mockReset();
    executeRawUnsafeMock.mockReset();
    executeRawUnsafeMock.mockResolvedValue(undefined);
    executeRawMock.mockResolvedValue(undefined);
  });

  it("uses in-memory TTL cache to avoid repeated reads", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);

    queryRawMock.mockResolvedValueOnce([
      {
        maxAvailableVideoId: 321,
        dirty: 0,
        verifiedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    ]);

    const { getAvailableVideoMaxId, resetAvailableVideoMaxIdRuntimeCache } = await import("@/lib/available-video-max-id");
    resetAvailableVideoMaxIdRuntimeCache();

    const first = await getAvailableVideoMaxId();
    const second = await getAvailableVideoMaxId();

    expect(first).toBe(321);
    expect(second).toBe(321);
    expect(queryRawMock).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });

  it("verifies authoritative max when state is dirty", async () => {
    queryRawMock
      .mockResolvedValueOnce([
        {
          maxAvailableVideoId: 999,
          dirty: 1,
          verifiedAt: new Date("2026-05-01T00:00:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([{ maxId: 456 }]);

    const { getAvailableVideoMaxId, resetAvailableVideoMaxIdRuntimeCache } = await import("@/lib/available-video-max-id");
    resetAvailableVideoMaxIdRuntimeCache();

    const maxId = await getAvailableVideoMaxId();

    expect(maxId).toBe(456);
    expect(queryRawMock).toHaveBeenCalledTimes(2);
    expect(executeRawMock).toHaveBeenCalledTimes(1);
  });

  it("authoritative compute queries MAX from site_videos (not 7M-row videos scan)", async () => {
    // When dirty, computeAndPersistAuthoritativeMaxId should fire.
    // Verify the query it uses reads from site_videos so MySQL can use the
    // (status, video_id) index instead of scanning all 7M videos rows.
    queryRawMock
      .mockResolvedValueOnce([
        {
          maxAvailableVideoId: 0,
          dirty: 1,
          verifiedAt: null,
        },
      ])
      .mockResolvedValueOnce([{ maxId: 99999 }]);

    const { getAvailableVideoMaxId, resetAvailableVideoMaxIdRuntimeCache } = await import("@/lib/available-video-max-id");
    resetAvailableVideoMaxIdRuntimeCache();

    const maxId = await getAvailableVideoMaxId();
    expect(maxId).toBe(99999);

    // The second $queryRaw call is the authoritative compute — inspect its SQL
    expect(queryRawMock).toHaveBeenCalledTimes(2);
    const authQueryArgs = queryRawMock.mock.calls[1];
    // Template literals are passed as a TemplateStringsArray; join gives the SQL skeleton
    const sqlSkeleton = Array.isArray(authQueryArgs[0])
      ? authQueryArgs[0].join("?")
      : String(authQueryArgs[0]);
    // Must query from site_videos using (status, video_id) index path
    expect(sqlSkeleton).toContain("site_videos");
    // Must NOT use the old correlated-EXISTS on the full videos table
    expect(sqlSkeleton).not.toMatch(/FROM\s+videos\s+v/i);
    expect(sqlSkeleton).not.toContain("EXISTS");
  });

  it("authoritative compute returns 0 when no available site videos exist", async () => {
    // Empty result from site_videos — should normalise to 0 and persist it
    queryRawMock
      .mockResolvedValueOnce([
        {
          maxAvailableVideoId: 0,
          dirty: 1,
          verifiedAt: null,
        },
      ])
      .mockResolvedValueOnce([{ maxId: null }]);

    const { getAvailableVideoMaxId, resetAvailableVideoMaxIdRuntimeCache } = await import("@/lib/available-video-max-id");
    resetAvailableVideoMaxIdRuntimeCache();

    const maxId = await getAvailableVideoMaxId();
    expect(maxId).toBe(0);
    // Should still persist the result (1 executeRaw call)
    expect(executeRawMock).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent lookups", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);

    let resolveStateRows: ((rows: Array<{ maxAvailableVideoId: number; dirty: number; verifiedAt: Date }>) => void) | null = null;
    const pendingStateRows = new Promise<Array<{ maxAvailableVideoId: number; dirty: number; verifiedAt: Date }>>((resolve) => {
      resolveStateRows = resolve;
    });

    queryRawMock.mockImplementationOnce(() => pendingStateRows);

    const { getAvailableVideoMaxId, resetAvailableVideoMaxIdRuntimeCache } = await import("@/lib/available-video-max-id");
    resetAvailableVideoMaxIdRuntimeCache();

    const firstPromise = getAvailableVideoMaxId();
    const secondPromise = getAvailableVideoMaxId();

    resolveStateRows?.([
      {
        maxAvailableVideoId: 123,
        dirty: 0,
        verifiedAt: new Date(999_000),
      },
    ]);

    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first).toBe(123);
    expect(second).toBe(123);
    expect(queryRawMock).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });
});
