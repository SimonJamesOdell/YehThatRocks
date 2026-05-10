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

  it("keeps hourly bucket SELECT and GROUP BY expressions synchronized for only_full_group_by safety", async () => {
    const { refreshRecentHourlyRollupsForTest } = await import("@/lib/admin-dashboard-rollups");
    await refreshRecentHourlyRollupsForTest({ fullScan: false });

    const analyticsInsertCalls = executeRawUnsafeMock.mock.calls.filter(([sql]: [string]) =>
      /INSERT INTO admin_dashboard_analytics_hourly/i.test(sql),
    );
    const authInsertCalls = executeRawUnsafeMock.mock.calls.filter(([sql]: [string]) =>
      /INSERT INTO admin_dashboard_auth_hourly/i.test(sql),
    );

    expect(analyticsInsertCalls).toHaveLength(1);
    expect(authInsertCalls).toHaveLength(1);

    const [analyticsSql] = analyticsInsertCalls[0] as [string];
    const [authSql] = authInsertCalls[0] as [string];

    const groupByExpr = "DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')";
    const selectExpr = `STR_TO_DATE(${groupByExpr}, '%Y-%m-%d %H:%i:%s') AS bucket_start`;

    expect(analyticsSql).toContain(selectExpr);
    expect(analyticsSql).toContain(`GROUP BY ${groupByExpr}`);
    expect(authSql).toContain(selectExpr);
    expect(authSql).toContain(`GROUP BY ${groupByExpr}`);
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

  it("refreshGeoVisitorRollup uses indexed geo predicate and visitor grouping", async () => {
    const { refreshGeoVisitorRollupForTest } = await import("@/lib/admin-dashboard-rollups");
    await refreshGeoVisitorRollupForTest();

    const upsertCalls = executeRawUnsafeMock.mock.calls.filter(([sql]: [string]) =>
      /INSERT INTO admin_dashboard_geo_visitors/i.test(sql),
    );
    expect(upsertCalls).toHaveLength(1);
    const [sql] = upsertCalls[0] as [string];
    expect(sql).toContain("FROM analytics_events");
    expect(sql).toContain("WHERE has_geo_coords = 1");
    expect(sql).toContain("GROUP BY visitor_id");
  });

  it("refreshGeoVisitorRollup falls back to null-check geo predicate when indexed path fails", async () => {
    executeRawUnsafeMock.mockReset();
    executeRawUnsafeMock
      .mockRejectedValueOnce(new Error("missing has_geo_coords column"))
      .mockResolvedValue(undefined);

    const { refreshGeoVisitorRollupForTest } = await import("@/lib/admin-dashboard-rollups");
    await refreshGeoVisitorRollupForTest();

    const upsertCalls = executeRawUnsafeMock.mock.calls.filter(([sql]: [string]) =>
      /INSERT INTO admin_dashboard_geo_visitors/i.test(sql),
    );
    expect(upsertCalls).toHaveLength(2);

    const [firstSql] = upsertCalls[0] as [string];
    const [secondSql] = upsertCalls[1] as [string];

    expect(firstSql).toContain("WHERE has_geo_coords = 1");
    expect(secondSql).toContain("WHERE geo_lat IS NOT NULL");
    expect(secondSql).toContain("AND geo_lng IS NOT NULL");
    expect(secondSql).toContain("GROUP BY visitor_id");
  });

  it("skips geo rollup refresh when geo staleness TTL has not expired", async () => {
    const { ensureAdminDashboardRollupsFresh, resetRollupsStateForTest } = await import("@/lib/admin-dashboard-rollups");
    resetRollupsStateForTest({
      lastRefreshedAtMs: 0,
      lastGeoVisitorRefreshMs: Date.now(),
      lastFullDailyRefreshMs: Date.now(),
      lastFullHourlyRefreshMs: Date.now(),
    });

    await ensureAdminDashboardRollupsFresh();

    const geoUpsertCalls = executeRawUnsafeMock.mock.calls.filter(([sql]: [string]) =>
      /INSERT INTO admin_dashboard_geo_visitors/i.test(sql),
    );
    expect(geoUpsertCalls).toHaveLength(0);
  });

  it("hourly rollup queries use only_full_group_by-safe SELECT and GROUP BY expressions", async () => {
    const { refreshRecentHourlyRollupsForTest } = await import("@/lib/admin-dashboard-rollups");
    await refreshRecentHourlyRollupsForTest({ fullScan: false });

    const insertCalls = executeRawUnsafeMock.mock.calls.filter(([sql]: [string]) =>
      /INSERT INTO admin_dashboard_analytics_hourly/i.test(sql),
    );
    expect(insertCalls).toHaveLength(1);
    const [sql] = insertCalls[0] as [string];

    // Extract SELECT expression and GROUP BY expression
    const selectMatch = sql.match(/STR_TO_DATE\s*\(\s*DATE_FORMAT\s*\(\s*created_at\s*,\s*'%Y-%m-%d\s+%H:00:00'\s*\)\s*,\s*'%Y-%m-%d\s+%H:%i:%s'\s*\)\s+AS\s+bucket_start/i);
    const groupByMatch = sql.match(/GROUP\s+BY\s+STR_TO_DATE\s*\(\s*DATE_FORMAT\s*\(\s*created_at\s*,\s*'%Y-%m-%d\s+%H:00:00'\s*\)\s*,\s*'%Y-%m-%d\s+%H:%i:%s'\s*\)/i);

    expect(selectMatch).not.toBeNull();
    expect(groupByMatch).not.toBeNull();

    // Verify the SELECT and GROUP BY expressions match exactly
    const selectExpr = selectMatch![0];
    const groupByExpr = groupByMatch![0].replace(/^GROUP\s+BY\s+/i, "");
    expect(selectExpr).toContain(groupByExpr);
  });
});
