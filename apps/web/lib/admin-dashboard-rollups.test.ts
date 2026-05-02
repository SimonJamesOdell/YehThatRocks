/**
 * Tests for rollup staleness gating and narrow-window fast-refresh behaviour.
 *
 * Key invariants:
 *  – The normal (60s) tick runs only the narrow today+yesterday INSERT, not
 *    the full 45-day scan.
 *  – The full 45-day scan only runs when lastFullDailyRefreshMs is older than
 *    FULL_DAILY_ROLLUP_INTERVAL_MS (6 h by default).
 *  – The narrow INSERT WHERE clause references UTC_DATE() / INTERVAL 1 DAY,
 *    not the full DAILY_RECENT_DAYS constant.
 *  – refreshRollupsNow triggers both the fast daily and hourly inserts; the
 *    hourly inserts use a narrow 2-hour window on normal ticks.
 *  – ensureAdminDashboardRollupsFresh respects in-memory TTL and doesn't
 *    trigger duplicate refreshes while one is in-flight.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const executeRawUnsafeMock = vi.fn();
const queryRawMock = vi.fn();
const queryRawUnsafeMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRawUnsafe: executeRawUnsafeMock,
    $queryRaw: queryRawMock,
    $queryRawUnsafe: queryRawUnsafeMock,
  },
}));

function makeTaggedTemplateMock(mock: ReturnType<typeof vi.fn>) {
  // Prisma tagged-template methods can be called with tagged template syntax
  // (strings, ...values). We capture the first template part to allow SQL inspection.
  const tagged = Object.assign(
    function taggedTemplate(strings: TemplateStringsArray, ..._values: unknown[]) {
      return mock(strings.join("?"));
    },
    { catch: () => Promise.resolve([]) },
  );
  return tagged;
}

describe("admin-dashboard-rollups narrow-window gating", () => {
  beforeEach(async () => {
    vi.resetModules();
    executeRawUnsafeMock.mockReset();
    queryRawMock.mockReset();
    queryRawUnsafeMock.mockReset();

    // Default: tables exist (CREATE TABLE IF NOT EXISTS is a no-op), columns exist
    executeRawUnsafeMock.mockResolvedValue(undefined);

    // information_schema column checks — simulate all columns already present
    queryRawUnsafeMock.mockResolvedValue([{ count: 1 }]);

    // $queryRaw (tagged) for backfill count check — return non-zero so no backfill
    queryRawMock.mockImplementation(() => Promise.resolve([{ count: 100 }]));
  });

  it("refreshRecentDailyRollups fast path only scans last 1 day, not full 45", async () => {
    const { refreshRecentDailyRollupsForTest } = await import("@/lib/admin-dashboard-rollups");
    // Call the exported fast-path function directly
    await refreshRecentDailyRollupsForTest({ fullScan: false });

    const insertCalls = executeRawUnsafeMock.mock.calls.filter(([sql]: [string]) =>
      /INSERT INTO admin_dashboard_analytics_daily/i.test(sql),
    );
    expect(insertCalls).toHaveLength(1);
    const [sql] = insertCalls[0] as [string];
    // Fast path: only scans since yesterday, not the full 45-day window
    expect(sql).toContain("INTERVAL 1 DAY");
    expect(sql).not.toContain(`INTERVAL 45 DAY`);
  });

  it("refreshRecentDailyRollups full scan path uses full DAILY_RECENT_DAYS window", async () => {
    const { refreshRecentDailyRollupsForTest } = await import("@/lib/admin-dashboard-rollups");
    await refreshRecentDailyRollupsForTest({ fullScan: true });

    const insertCalls = executeRawUnsafeMock.mock.calls.filter(([sql]: [string]) =>
      /INSERT INTO admin_dashboard_analytics_daily/i.test(sql),
    );
    expect(insertCalls).toHaveLength(1);
    const [sql] = insertCalls[0] as [string];
    expect(sql).toContain("INTERVAL 45 DAY");
  });

  it("refreshRecentHourlyRollups fast path scans only last 2 hours", async () => {
    const { refreshRecentHourlyRollupsForTest } = await import("@/lib/admin-dashboard-rollups");
    await refreshRecentHourlyRollupsForTest({ fullScan: false });

    const insertCalls = executeRawUnsafeMock.mock.calls.filter(([sql]: [string]) =>
      /INSERT INTO admin_dashboard_analytics_hourly/i.test(sql),
    );
    expect(insertCalls).toHaveLength(1);
    const [sql] = insertCalls[0] as [string];
    expect(sql).toContain("INTERVAL 2 HOUR");
    expect(sql).not.toContain("INTERVAL 21 DAY");
  });

  it("refreshRecentHourlyRollups full scan path uses full HOURLY_RECENT_DAYS window", async () => {
    const { refreshRecentHourlyRollupsForTest } = await import("@/lib/admin-dashboard-rollups");
    await refreshRecentHourlyRollupsForTest({ fullScan: true });

    const insertCalls = executeRawUnsafeMock.mock.calls.filter(([sql]: [string]) =>
      /INSERT INTO admin_dashboard_analytics_hourly/i.test(sql),
    );
    expect(insertCalls).toHaveLength(1);
    const [sql] = insertCalls[0] as [string];
    expect(sql).toContain("INTERVAL 21 DAY");
  });

  it("ensureAdminDashboardRollupsFresh skips refresh when in-memory TTL not expired", async () => {
    const { ensureAdminDashboardRollupsFresh, resetRollupsStateForTest } = await import("@/lib/admin-dashboard-rollups");
    resetRollupsStateForTest({ lastRefreshedAtMs: Date.now() });

    await ensureAdminDashboardRollupsFresh();

    const insertCalls = executeRawUnsafeMock.mock.calls.filter(([sql]: [string]) =>
      /INSERT INTO admin_dashboard/i.test(sql),
    );
    expect(insertCalls).toHaveLength(0);
  });

  it("ensureAdminDashboardRollupsFresh triggers refresh when TTL expired", async () => {
    const { ensureAdminDashboardRollupsFresh, resetRollupsStateForTest } = await import("@/lib/admin-dashboard-rollups");
    resetRollupsStateForTest({ lastRefreshedAtMs: 0 });

    await ensureAdminDashboardRollupsFresh();

    const insertCalls = executeRawUnsafeMock.mock.calls.filter(([sql]: [string]) =>
      /INSERT INTO admin_dashboard/i.test(sql),
    );
    expect(insertCalls.length).toBeGreaterThan(0);
  });
});
