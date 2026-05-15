import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawUnsafeMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRawUnsafe: queryRawUnsafeMock,
  },
}));

describe("admin catalog review queue count cache", () => {
  beforeEach(async () => {
    vi.resetModules();
    queryRawUnsafeMock.mockReset();
  });

  it("returns cached count within TTL without extra DB reads", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(100_000);

    queryRawUnsafeMock.mockResolvedValue([{ total: 12 }]);

    const {
      clearCatalogReviewQueueCountCache,
      getCatalogReviewQueueCount,
    } = await import("@/lib/admin-catalog-review-count");

    clearCatalogReviewQueueCountCache();

    const first = await getCatalogReviewQueueCount();
    const second = await getCatalogReviewQueueCount();

    expect(first).toBe(12);
    expect(second).toBe(12);
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
  });

  it("refreshes from DB after TTL expiry", async () => {
    const nowSpy = vi.spyOn(Date, "now");

    queryRawUnsafeMock
      .mockResolvedValueOnce([{ total: 15 }])
      .mockResolvedValueOnce([{ total: 9 }]);

    const {
      CATALOG_REVIEW_QUEUE_COUNT_TTL_MS,
      clearCatalogReviewQueueCountCache,
      getCatalogReviewQueueCount,
    } = await import("@/lib/admin-catalog-review-count");

    clearCatalogReviewQueueCountCache();

    nowSpy.mockReturnValue(200_000);
    const first = await getCatalogReviewQueueCount();

    nowSpy.mockReturnValue(200_000 + CATALOG_REVIEW_QUEUE_COUNT_TTL_MS + 1);
    const second = await getCatalogReviewQueueCount();

    expect(first).toBe(15);
    expect(second).toBe(9);
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it("applies mutation delta without DB read when cache is warm", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(300_000);

    queryRawUnsafeMock.mockResolvedValue([{ total: 40 }]);

    const {
      applyCatalogReviewQueueCountDelta,
      clearCatalogReviewQueueCountCache,
      getCatalogReviewQueueCount,
    } = await import("@/lib/admin-catalog-review-count");

    clearCatalogReviewQueueCountCache();

    const initial = await getCatalogReviewQueueCount();
    const afterApprove = await applyCatalogReviewQueueCountDelta(-1);
    const afterUndo = await applyCatalogReviewQueueCountDelta(1);

    expect(initial).toBe(40);
    expect(afterApprove).toBe(39);
    expect(afterUndo).toBe(40);
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
  });

  it("falls back to exact DB read for mutation delta when cache is cold", async () => {
    queryRawUnsafeMock.mockResolvedValue([{ total: 8 }]);

    const {
      applyCatalogReviewQueueCountDelta,
      clearCatalogReviewQueueCountCache,
    } = await import("@/lib/admin-catalog-review-count");

    clearCatalogReviewQueueCountCache();

    const remaining = await applyCatalogReviewQueueCountDelta(-1);

    expect(remaining).toBe(8);
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(1);
  });
});
