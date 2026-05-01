import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawUnsafeMock = vi.fn();
const executeRawUnsafeMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRawUnsafe: queryRawUnsafeMock,
    $executeRawUnsafe: executeRawUnsafeMock,
  },
}));

describe("admin pending video queue helper", () => {
  beforeEach(async () => {
    vi.resetModules();
    queryRawUnsafeMock.mockReset();
    executeRawUnsafeMock.mockReset();
  });

  it("uses index-friendly pending approval predicate", async () => {
    const { PENDING_VIDEO_APPROVAL_WHERE_CLAUSE } = await import("@/lib/admin-pending-video-queue");

    expect(PENDING_VIDEO_APPROVAL_WHERE_CLAUSE).toBe("(approved = 0 OR approved IS NULL)");
    expect(PENDING_VIDEO_APPROVAL_WHERE_CLAUSE).not.toContain("COALESCE");
  });

  it("creates queue index when missing and skips later checks", async () => {
    queryRawUnsafeMock.mockResolvedValueOnce([]);
    executeRawUnsafeMock.mockResolvedValueOnce(0);

    const { ensurePendingVideoQueueIndex, resetPendingVideoQueueIndexEnsureState } = await import("@/lib/admin-pending-video-queue");
    resetPendingVideoQueueIndexEnsureState();

    await ensurePendingVideoQueueIndex();
    await ensurePendingVideoQueueIndex();

    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(1);
    expect(executeRawUnsafeMock).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent index ensure calls", async () => {
    let resolveIndexLookup: ((value: Array<{ Key_name?: string }>) => void) | null = null;

    queryRawUnsafeMock.mockImplementationOnce(
      () =>
        new Promise<Array<{ Key_name?: string }>>((resolve) => {
          resolveIndexLookup = resolve;
        }),
    );
    executeRawUnsafeMock.mockResolvedValueOnce(0);

    const { ensurePendingVideoQueueIndex, resetPendingVideoQueueIndexEnsureState } = await import("@/lib/admin-pending-video-queue");
    resetPendingVideoQueueIndexEnsureState();

    const first = ensurePendingVideoQueueIndex();
    const second = ensurePendingVideoQueueIndex();

    resolveIndexLookup?.([]);

    await Promise.all([first, second]);

    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(1);
    expect(executeRawUnsafeMock).toHaveBeenCalledTimes(1);
  });
});
