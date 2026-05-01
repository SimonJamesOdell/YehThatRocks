import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: queryRawMock,
  },
}));

describe("admin dashboard auth audit counter cache", () => {
  beforeEach(async () => {
    vi.resetModules();
    queryRawMock.mockReset();
  });

  it("caches auth audit counters within TTL", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);

    queryRawMock
      .mockResolvedValueOnce([{ total: 7, success: 6, failed: 1, uniqueIps: 5, uniqueUsers: 3 }])
      .mockResolvedValueOnce([{ action: "login", total: 7, failed: 1 }])
      .mockResolvedValueOnce([{ day: new Date("2026-05-01T00:00:00.000Z"), count: 7 }]);

    const { clearAdminDashboardAuthAuditCountersCache, getAdminDashboardAuthAuditCounters } = await import("@/lib/admin-dashboard-auth-counters");
    clearAdminDashboardAuthAuditCountersCache();

    const first = await getAdminDashboardAuthAuditCounters();
    const second = await getAdminDashboardAuthAuditCounters();

    expect(first.auth24h[0]?.total).toBe(7);
    expect(second.auth24h[0]?.total).toBe(7);
    expect(queryRawMock).toHaveBeenCalledTimes(3);

    nowSpy.mockRestore();
  });

  it("refreshes auth audit counters after TTL expiry", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);

    queryRawMock
      .mockResolvedValueOnce([{ total: 7, success: 6, failed: 1, uniqueIps: 5, uniqueUsers: 3 }])
      .mockResolvedValueOnce([{ action: "login", total: 7, failed: 1 }])
      .mockResolvedValueOnce([{ day: new Date("2026-05-01T00:00:00.000Z"), count: 7 }])
      .mockResolvedValueOnce([{ total: 9, success: 8, failed: 1, uniqueIps: 6, uniqueUsers: 4 }])
      .mockResolvedValueOnce([{ action: "login", total: 9, failed: 1 }])
      .mockResolvedValueOnce([{ day: new Date("2026-05-01T00:00:00.000Z"), count: 9 }]);

    const { clearAdminDashboardAuthAuditCountersCache, getAdminDashboardAuthAuditCounters } = await import("@/lib/admin-dashboard-auth-counters");
    clearAdminDashboardAuthAuditCountersCache();

    const first = await getAdminDashboardAuthAuditCounters();
    nowSpy.mockReturnValue(1_030_001);
    const second = await getAdminDashboardAuthAuditCounters();

    expect(first.auth24h[0]?.total).toBe(7);
    expect(second.auth24h[0]?.total).toBe(9);
    expect(queryRawMock).toHaveBeenCalledTimes(6);

    nowSpy.mockRestore();
  });

  it("coalesces concurrent requests into one query batch", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);

    let resolveAuth24h: ((value: Array<{ total: number; success: number; failed: number; uniqueIps: number; uniqueUsers: number }>) => void) | null = null;

    const auth24hPromise = new Promise<Array<{ total: number; success: number; failed: number; uniqueIps: number; uniqueUsers: number }>>((resolve) => {
      resolveAuth24h = resolve;
    });

    queryRawMock
      .mockImplementationOnce(() => auth24hPromise)
      .mockResolvedValueOnce([{ action: "login", total: 7, failed: 1 }])
      .mockResolvedValueOnce([{ day: new Date("2026-05-01T00:00:00.000Z"), count: 7 }]);

    const { clearAdminDashboardAuthAuditCountersCache, getAdminDashboardAuthAuditCounters } = await import("@/lib/admin-dashboard-auth-counters");
    clearAdminDashboardAuthAuditCountersCache();

    const firstPromise = getAdminDashboardAuthAuditCounters();
    const secondPromise = getAdminDashboardAuthAuditCounters();

    resolveAuth24h?.([{ total: 7, success: 6, failed: 1, uniqueIps: 5, uniqueUsers: 3 }]);

    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.auth24h[0]?.total).toBe(7);
    expect(second.auth24h[0]?.total).toBe(7);
    expect(queryRawMock).toHaveBeenCalledTimes(3);

    nowSpy.mockRestore();
  });
});
