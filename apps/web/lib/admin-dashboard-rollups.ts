import { prisma } from "@/lib/db";

type DailyAnalyticsRollupRow = {
  day: Date;
  pageViews: bigint | number;
  videoViews: bigint | number;
  uniqueVisitors: bigint | number;
  returnVisits: bigint | number;
  newVisitors: bigint | number;
  repeatVisitors: bigint | number;
  totalSessions: bigint | number;
  authEvents: bigint | number;
  registrations: bigint | number;
};

type HourlyAnalyticsRollupRow = {
  bucketStart: Date | string;
  pageViews: bigint | number;
  videoViews: bigint | number;
  uniqueVisitors: bigint | number;
  returnVisits: bigint | number;
};

type HourlyAuthRollupRow = {
  bucketStart: Date | string;
  authEvents: bigint | number;
};

type GeoVisitorRollupRow = {
  visitorId: string;
  lat: bigint | number | string;
  lng: bigint | number | string;
  eventCount: bigint | number;
  lastSeenAt: Date | string;
};

type DashboardRollupRead = {
  analyticsDaily: Array<{ day: Date; pageViews: bigint | number; videoViews: bigint | number; uniqueVisitors: bigint | number }>;
  hourlyRecentAnalytics: HourlyAnalyticsRollupRow[];
  hourlyRecentAuth: HourlyAuthRollupRow[];
  analyticsNewVsRepeat: Array<{ newVisitors: bigint | number; repeatVisitors: bigint | number }>;
  registrationsPerDay: Array<{ day: Date; count: bigint | number }>;
  analyticsTotals: Array<{
    totalPageViews: bigint | number;
    totalVideoViews: bigint | number;
    uniqueVisitors: bigint | number;
    totalSessions: bigint | number;
  }>;
  geoVisitors: GeoVisitorRollupRow[];
  earliestAnalyticsAt: Array<{ earliestAt: Date | null }>;
  earliestAuthAt: Array<{ earliestAt: Date | null }>;
  dailySeriesRows: DailyAnalyticsRollupRow[];
};

const ROLLUP_INTERVAL_MS = Math.max(30_000, Number(process.env.ADMIN_DASHBOARD_ROLLUP_INTERVAL_MS || "60000"));
const DAILY_RECENT_DAYS = 45;
const HOURLY_RECENT_DAYS = 21;
const DAILY_RETENTION_DAYS = 365 * 8;
const HOURLY_RETENTION_DAYS = 35;
const GEO_VISITOR_ROLLUP_INTERVAL_MS = Math.max(60_000, Number(process.env.ADMIN_DASHBOARD_GEO_ROLLUP_INTERVAL_MS || "600000"));
// How often to run the expensive full historical scan (past DAILY_RECENT_DAYS / HOURLY_RECENT_DAYS).
// Normal ticks use a narrow window (today+yesterday / last 2 hours) instead.
const FULL_SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

let rollupsStarted = false;
let rollupsInFlight: Promise<void> | null = null;
let rollupsLastRefreshedAtMs = 0;
let lastFullDailyRefreshMs = 0;
let lastFullHourlyRefreshMs = 0;
let lastGeoVisitorRefreshMs = 0;
let dailyBackfillDone = false;
let usersCreatedAtColumnPromise: Promise<string | null> | null = null;

async function getUsersCreatedAtColumn() {
  if (!usersCreatedAtColumnPromise) {
    usersCreatedAtColumnPromise = prisma.$queryRaw<Array<{ columnName: string }>>`
      SELECT column_name AS columnName
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND column_name IN ('created_at', 'createdAt')
      ORDER BY CASE column_name WHEN 'created_at' THEN 0 ELSE 1 END
      LIMIT 1
    `
      .then((rows) => rows[0]?.columnName ?? null)
      .catch(() => null);
  }

  return usersCreatedAtColumnPromise;
}

async function buildRegistrationsDailyJoinSql(options?: { recentDays?: number }) {
  const usersCreatedAtColumn = await getUsersCreatedAtColumn();
  if (!usersCreatedAtColumn) {
    return `
      LEFT JOIN (
        SELECT NULL AS day_date, 0 AS registrations
        WHERE 1 = 0
      ) reg ON reg.day_date = metrics.day_date
    `;
  }

  const recentClause = options?.recentDays != null
    ? `WHERE ${usersCreatedAtColumn} >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${options.recentDays} DAY)`
    : "";

  return `
    LEFT JOIN (
      SELECT DATE(${usersCreatedAtColumn}) AS day_date, COUNT(*) AS registrations
      FROM users
      ${recentClause}
      GROUP BY DATE(${usersCreatedAtColumn})
    ) reg ON reg.day_date = metrics.day_date
  `;
}

async function ensureColumnExists(tableName: string, columnName: string, columnDefinitionSql: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = '${tableName}'
        AND column_name = '${columnName}'
    `,
  );

  if (Number(rows[0]?.count ?? 0) > 0) {
    return;
  }

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${tableName}
    ADD COLUMN ${columnName} ${columnDefinitionSql}
  `);
}

async function ensureRollupTableShape() {
  await ensureColumnExists("admin_dashboard_analytics_daily", "return_visits", "BIGINT NOT NULL DEFAULT 0");
  await ensureColumnExists("admin_dashboard_analytics_daily", "new_visitors", "BIGINT NOT NULL DEFAULT 0");
  await ensureColumnExists("admin_dashboard_analytics_daily", "repeat_visitors", "BIGINT NOT NULL DEFAULT 0");
  await ensureColumnExists("admin_dashboard_analytics_daily", "total_sessions", "BIGINT NOT NULL DEFAULT 0");
  await ensureColumnExists("admin_dashboard_analytics_daily", "auth_events", "BIGINT NOT NULL DEFAULT 0");
  await ensureColumnExists("admin_dashboard_analytics_daily", "registrations", "BIGINT NOT NULL DEFAULT 0");
  await ensureColumnExists(
    "admin_dashboard_analytics_daily",
    "updated_at",
    "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)",
  );

  await ensureColumnExists("admin_dashboard_analytics_hourly", "return_visits", "BIGINT NOT NULL DEFAULT 0");
  await ensureColumnExists(
    "admin_dashboard_analytics_hourly",
    "updated_at",
    "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)",
  );

  await ensureColumnExists("admin_dashboard_auth_hourly", "auth_events", "BIGINT NOT NULL DEFAULT 0");
  await ensureColumnExists(
    "admin_dashboard_auth_hourly",
    "updated_at",
    "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)",
  );

  await ensureColumnExists(
    "admin_dashboard_geo_visitors",
    "updated_at",
    "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)",
  );
}

async function ensureRollupTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS admin_dashboard_analytics_daily (
      day_date DATE NOT NULL,
      page_views BIGINT NOT NULL DEFAULT 0,
      video_views BIGINT NOT NULL DEFAULT 0,
      unique_visitors BIGINT NOT NULL DEFAULT 0,
      return_visits BIGINT NOT NULL DEFAULT 0,
      new_visitors BIGINT NOT NULL DEFAULT 0,
      repeat_visitors BIGINT NOT NULL DEFAULT 0,
      total_sessions BIGINT NOT NULL DEFAULT 0,
      auth_events BIGINT NOT NULL DEFAULT 0,
      registrations BIGINT NOT NULL DEFAULT 0,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (day_date),
      KEY idx_admin_dash_daily_updated_at (updated_at)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS admin_dashboard_analytics_hourly (
      bucket_start DATETIME(0) NOT NULL,
      page_views BIGINT NOT NULL DEFAULT 0,
      video_views BIGINT NOT NULL DEFAULT 0,
      unique_visitors BIGINT NOT NULL DEFAULT 0,
      return_visits BIGINT NOT NULL DEFAULT 0,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (bucket_start),
      KEY idx_admin_dash_hourly_updated_at (updated_at)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS admin_dashboard_auth_hourly (
      bucket_start DATETIME(0) NOT NULL,
      auth_events BIGINT NOT NULL DEFAULT 0,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (bucket_start),
      KEY idx_admin_dash_auth_hourly_updated_at (updated_at)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS admin_dashboard_geo_visitors (
      visitor_id VARCHAR(191) NOT NULL,
      avg_geo_lat DOUBLE NOT NULL,
      avg_geo_lng DOUBLE NOT NULL,
      event_count BIGINT NOT NULL DEFAULT 0,
      last_seen_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (visitor_id),
      KEY idx_admin_dash_geo_last_seen_at (last_seen_at),
      KEY idx_admin_dash_geo_updated_at (updated_at)
    )
  `);

  await ensureRollupTableShape();
}

async function refreshGeoVisitorRollup() {
  // Prefer has_geo_coords (generated column + index) when present for better
  // grouping/filter performance; fall back to null checks for compatibility.
  try {
    await prisma.$executeRawUnsafe(`
      INSERT INTO admin_dashboard_geo_visitors (
        visitor_id,
        avg_geo_lat,
        avg_geo_lng,
        event_count,
        last_seen_at
      )
      SELECT
        visitor_id,
        AVG(geo_lat) AS avg_geo_lat,
        AVG(geo_lng) AS avg_geo_lng,
        COUNT(*) AS event_count,
        MAX(created_at) AS last_seen_at
      FROM analytics_events
      WHERE has_geo_coords = 1
      GROUP BY visitor_id
      ON DUPLICATE KEY UPDATE
        avg_geo_lat = VALUES(avg_geo_lat),
        avg_geo_lng = VALUES(avg_geo_lng),
        event_count = VALUES(event_count),
        last_seen_at = VALUES(last_seen_at),
        updated_at = CURRENT_TIMESTAMP(3)
    `);
  } catch {
    await prisma.$executeRawUnsafe(`
      INSERT INTO admin_dashboard_geo_visitors (
        visitor_id,
        avg_geo_lat,
        avg_geo_lng,
        event_count,
        last_seen_at
      )
      SELECT
        visitor_id,
        AVG(geo_lat) AS avg_geo_lat,
        AVG(geo_lng) AS avg_geo_lng,
        COUNT(*) AS event_count,
        MAX(created_at) AS last_seen_at
      FROM analytics_events
      WHERE geo_lat IS NOT NULL
        AND geo_lng IS NOT NULL
      GROUP BY visitor_id
      ON DUPLICATE KEY UPDATE
        avg_geo_lat = VALUES(avg_geo_lat),
        avg_geo_lng = VALUES(avg_geo_lng),
        event_count = VALUES(event_count),
        last_seen_at = VALUES(last_seen_at),
        updated_at = CURRENT_TIMESTAMP(3)
    `);
  }

  // Remove stale visitors no longer present in source with geo coordinates.
  await prisma.$executeRawUnsafe(`
    DELETE gv
    FROM admin_dashboard_geo_visitors gv
    LEFT JOIN (
      SELECT DISTINCT visitor_id
      FROM analytics_events
      WHERE geo_lat IS NOT NULL
        AND geo_lng IS NOT NULL
    ) src ON src.visitor_id = gv.visitor_id
    WHERE src.visitor_id IS NULL
  `);

  lastGeoVisitorRefreshMs = Date.now();
}

/** Exported for unit tests only — do not call from application code. */
export async function refreshGeoVisitorRollupForTest() {
  return refreshGeoVisitorRollup();
}

async function maybeBackfillDailyHistory() {
  if (dailyBackfillDone) return;

  const registrationsDailyJoinSql = await buildRegistrationsDailyJoinSql();

  const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
    SELECT COUNT(*) AS count FROM admin_dashboard_analytics_daily
  `;
  const count = Number(rows[0]?.count ?? 0);

  if (count === 0) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO admin_dashboard_analytics_daily (
        day_date,
        page_views,
        video_views,
        unique_visitors,
        return_visits,
        new_visitors,
        repeat_visitors,
        total_sessions,
        auth_events,
        registrations
      )
      SELECT
        metrics.day_date,
        metrics.page_views,
        metrics.video_views,
        metrics.unique_visitors,
        metrics.return_visits,
        metrics.new_visitors,
        metrics.repeat_visitors,
        metrics.total_sessions,
        COALESCE(auth.auth_events, 0) AS auth_events,
        COALESCE(reg.registrations, 0) AS registrations
      FROM (
        SELECT
          DATE(created_at) AS day_date,
          SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
          SUM(CASE WHEN event_type = 'video_view' THEN 1 ELSE 0 END) AS video_views,
          COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_id END) AS unique_visitors,
          COUNT(DISTINCT CASE WHEN event_type = 'page_view' AND is_new_visitor = 0 THEN visitor_id END) AS return_visits,
          SUM(CASE WHEN event_type = 'page_view' AND is_new_visitor = 1 THEN 1 ELSE 0 END) AS new_visitors,
          SUM(CASE WHEN event_type = 'page_view' AND is_new_visitor = 0 THEN 1 ELSE 0 END) AS repeat_visitors,
          COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN session_id END) AS total_sessions
        FROM analytics_events
        GROUP BY DATE(created_at)
      ) metrics
      LEFT JOIN (
        SELECT DATE(created_at) AS day_date, COUNT(*) AS auth_events
        FROM auth_audit_logs
        GROUP BY DATE(created_at)
      ) auth ON auth.day_date = metrics.day_date
      ${registrationsDailyJoinSql}
      ON DUPLICATE KEY UPDATE
        page_views = VALUES(page_views),
        video_views = VALUES(video_views),
        unique_visitors = VALUES(unique_visitors),
        return_visits = VALUES(return_visits),
        new_visitors = VALUES(new_visitors),
        repeat_visitors = VALUES(repeat_visitors),
        total_sessions = VALUES(total_sessions),
        auth_events = VALUES(auth_events),
        registrations = VALUES(registrations),
        updated_at = CURRENT_TIMESTAMP(3)
    `);
  }

  dailyBackfillDone = true;
}

async function refreshRecentDailyRollups(options: { fullScan: boolean }) {
  // Fast path: only recompute today and yesterday — past days are immutable.
  // Full path (every 6 h): recompute the full DAILY_RECENT_DAYS window to
  // catch any late-arriving events or day-boundary edge cases.
  const intervalDays = options.fullScan ? DAILY_RECENT_DAYS : 1;
  const registrationsDailyJoinSql = await buildRegistrationsDailyJoinSql({ recentDays: intervalDays });

  await prisma.$executeRawUnsafe(`
    INSERT INTO admin_dashboard_analytics_daily (
      day_date,
      page_views,
      video_views,
      unique_visitors,
      return_visits,
      new_visitors,
      repeat_visitors,
      total_sessions,
      auth_events,
      registrations
    )
    SELECT
      metrics.day_date,
      metrics.page_views,
      metrics.video_views,
      metrics.unique_visitors,
      metrics.return_visits,
      metrics.new_visitors,
      metrics.repeat_visitors,
      metrics.total_sessions,
      COALESCE(auth.auth_events, 0) AS auth_events,
      COALESCE(reg.registrations, 0) AS registrations
    FROM (
      SELECT
        DATE(created_at) AS day_date,
        SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
        SUM(CASE WHEN event_type = 'video_view' THEN 1 ELSE 0 END) AS video_views,
        COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_id END) AS unique_visitors,
        COUNT(DISTINCT CASE WHEN event_type = 'page_view' AND is_new_visitor = 0 THEN visitor_id END) AS return_visits,
        SUM(CASE WHEN event_type = 'page_view' AND is_new_visitor = 1 THEN 1 ELSE 0 END) AS new_visitors,
        SUM(CASE WHEN event_type = 'page_view' AND is_new_visitor = 0 THEN 1 ELSE 0 END) AS repeat_visitors,
        COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN session_id END) AS total_sessions
      FROM analytics_events
      WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${intervalDays} DAY)
      GROUP BY DATE(created_at)
    ) metrics
    LEFT JOIN (
      SELECT DATE(created_at) AS day_date, COUNT(*) AS auth_events
      FROM auth_audit_logs
      WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${intervalDays} DAY)
      GROUP BY DATE(created_at)
    ) auth ON auth.day_date = metrics.day_date
    ${registrationsDailyJoinSql}
    ON DUPLICATE KEY UPDATE
      page_views = VALUES(page_views),
      video_views = VALUES(video_views),
      unique_visitors = VALUES(unique_visitors),
      return_visits = VALUES(return_visits),
      new_visitors = VALUES(new_visitors),
      repeat_visitors = VALUES(repeat_visitors),
      total_sessions = VALUES(total_sessions),
      auth_events = VALUES(auth_events),
      registrations = VALUES(registrations),
      updated_at = CURRENT_TIMESTAMP(3)
  `);

  if (options.fullScan) {
    lastFullDailyRefreshMs = Date.now();
  }
}

/** Exported for unit tests only — do not call from application code. */
export async function refreshRecentDailyRollupsForTest(options: { fullScan: boolean }) {
  return refreshRecentDailyRollups(options);
}

async function refreshRecentHourlyRollups(options: { fullScan: boolean }) {
  // Fast path: only recompute the current and previous hour buckets (2-hour window).
  // Full path (every 6 h): recompute the full HOURLY_RECENT_DAYS window.
  const analyticsIntervalClause = options.fullScan
    ? `INTERVAL ${HOURLY_RECENT_DAYS} DAY`
    : `INTERVAL 2 HOUR`;
  const authIntervalClause = options.fullScan
    ? `INTERVAL ${HOURLY_RECENT_DAYS} DAY`
    : `INTERVAL 2 HOUR`;
  const hourlyBucketSql = `STR_TO_DATE(DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00'), '%Y-%m-%d %H:%i:%s')`;

  await prisma.$executeRawUnsafe(`
    INSERT INTO admin_dashboard_analytics_hourly (
      bucket_start,
      page_views,
      video_views,
      unique_visitors,
      return_visits
    )
    SELECT
      ${hourlyBucketSql} AS bucket_start,
      SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
      SUM(CASE WHEN event_type = 'video_view' THEN 1 ELSE 0 END) AS video_views,
      COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_id END) AS unique_visitors,
      COUNT(DISTINCT CASE WHEN event_type = 'page_view' AND is_new_visitor = 0 THEN visitor_id END) AS return_visits
    FROM analytics_events
    WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), ${analyticsIntervalClause})
    GROUP BY ${hourlyBucketSql}
    ON DUPLICATE KEY UPDATE
      page_views = VALUES(page_views),
      video_views = VALUES(video_views),
      unique_visitors = VALUES(unique_visitors),
      return_visits = VALUES(return_visits),
      updated_at = CURRENT_TIMESTAMP(3)
  `);

  await prisma.$executeRawUnsafe(`
    INSERT INTO admin_dashboard_auth_hourly (
      bucket_start,
      auth_events
    )
    SELECT
      ${hourlyBucketSql} AS bucket_start,
      COUNT(*) AS auth_events
    FROM auth_audit_logs
    WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), ${authIntervalClause})
    GROUP BY ${hourlyBucketSql}
    ON DUPLICATE KEY UPDATE
      auth_events = VALUES(auth_events),
      updated_at = CURRENT_TIMESTAMP(3)
  `);

  if (options.fullScan) {
    lastFullHourlyRefreshMs = Date.now();
  }
}

/** Exported for unit tests only — do not call from application code. */
export async function refreshRecentHourlyRollupsForTest(options: { fullScan: boolean }) {
  return refreshRecentHourlyRollups(options);
}

async function pruneOldRollupRows() {
  await Promise.all([
    prisma.$executeRawUnsafe(`
      DELETE FROM admin_dashboard_analytics_hourly
      WHERE bucket_start < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${HOURLY_RETENTION_DAYS} DAY)
    `),
    prisma.$executeRawUnsafe(`
      DELETE FROM admin_dashboard_auth_hourly
      WHERE bucket_start < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${HOURLY_RETENTION_DAYS} DAY)
    `),
    prisma.$executeRawUnsafe(`
      DELETE FROM admin_dashboard_analytics_daily
      WHERE day_date < DATE_SUB(UTC_DATE(), INTERVAL ${DAILY_RETENTION_DAYS} DAY)
    `),
  ]);
}

async function refreshRollupsNow(options?: { force?: boolean }) {
  const now = Date.now();
  const doFullScan = now - lastFullDailyRefreshMs >= FULL_SCAN_INTERVAL_MS;
  const doFullHourlyScan = now - lastFullHourlyRefreshMs >= FULL_SCAN_INTERVAL_MS;
  const doGeoRollupRefresh = Boolean(options?.force) || now - lastGeoVisitorRefreshMs >= GEO_VISITOR_ROLLUP_INTERVAL_MS;

  await ensureRollupTables();
  await maybeBackfillDailyHistory();
  await refreshRecentDailyRollups({ fullScan: doFullScan });
  await refreshRecentHourlyRollups({ fullScan: doFullHourlyScan });
  if (doGeoRollupRefresh) {
    await refreshGeoVisitorRollup();
  }
  await pruneOldRollupRows();
  rollupsLastRefreshedAtMs = Date.now();
}

export async function ensureAdminDashboardRollupsFresh(options?: { force?: boolean }) {
  const force = Boolean(options?.force);
  if (!force && Date.now() - rollupsLastRefreshedAtMs < ROLLUP_INTERVAL_MS) {
    return;
  }

  if (!rollupsInFlight) {
    rollupsInFlight = refreshRollupsNow({ force }).finally(() => {
      rollupsInFlight = null;
    });
  }

  await rollupsInFlight;
}

/** Reset module-level state — for unit tests only. */
export function resetRollupsStateForTest(state: {
  lastRefreshedAtMs?: number;
  lastFullDailyRefreshMs?: number;
  lastFullHourlyRefreshMs?: number;
  lastGeoVisitorRefreshMs?: number;
}) {
  if (state.lastRefreshedAtMs !== undefined) rollupsLastRefreshedAtMs = state.lastRefreshedAtMs;
  if (state.lastFullDailyRefreshMs !== undefined) lastFullDailyRefreshMs = state.lastFullDailyRefreshMs;
  if (state.lastFullHourlyRefreshMs !== undefined) lastFullHourlyRefreshMs = state.lastFullHourlyRefreshMs;
  if (state.lastGeoVisitorRefreshMs !== undefined) lastGeoVisitorRefreshMs = state.lastGeoVisitorRefreshMs;
  rollupsInFlight = null;
  dailyBackfillDone = true; // prevent backfill scan in tests
}

export function startAdminDashboardRollups() {
  if (rollupsStarted || !process.env.DATABASE_URL) {
    return;
  }

  rollupsStarted = true;
  void ensureAdminDashboardRollupsFresh({ force: true }).catch((error) => {
    console.error("Initial admin dashboard rollup refresh failed", error);
  });

  const timer = setInterval(() => {
    void ensureAdminDashboardRollupsFresh().catch((error) => {
      console.error("Scheduled admin dashboard rollup refresh failed", error);
    });
  }, ROLLUP_INTERVAL_MS);
  timer.unref?.();
}

export async function readAdminDashboardRollups(): Promise<DashboardRollupRead> {
  await ensureAdminDashboardRollupsFresh();

  const [
    analyticsDaily,
    hourlyRecentAnalytics,
    hourlyRecentAuth,
    analyticsNewVsRepeat,
    registrationsPerDay,
    analyticsTotals,
    geoVisitors,
    earliestAnalyticsAt,
    earliestAuthAt,
    dailySeriesRows,
  ] = await Promise.all([
    prisma.$queryRaw<Array<{ day: Date; pageViews: bigint | number; videoViews: bigint | number; uniqueVisitors: bigint | number }>>`
      SELECT
        day_date AS day,
        page_views AS pageViews,
        video_views AS videoViews,
        unique_visitors AS uniqueVisitors
      FROM admin_dashboard_analytics_daily
      WHERE day_date >= DATE_SUB(UTC_DATE(), INTERVAL 30 DAY)
      ORDER BY day_date DESC
      LIMIT 30
    `.catch(() => []),
    prisma.$queryRaw<HourlyAnalyticsRollupRow[]>`
      SELECT
        bucket_start AS bucketStart,
        page_views AS pageViews,
        video_views AS videoViews,
        unique_visitors AS uniqueVisitors,
        return_visits AS returnVisits
      FROM admin_dashboard_analytics_hourly
      WHERE bucket_start >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
      ORDER BY bucket_start ASC
    `.catch(() => []),
    prisma.$queryRaw<HourlyAuthRollupRow[]>`
      SELECT
        bucket_start AS bucketStart,
        auth_events AS authEvents
      FROM admin_dashboard_auth_hourly
      WHERE bucket_start >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
      ORDER BY bucket_start ASC
    `.catch(() => []),
    prisma.$queryRaw<Array<{ newVisitors: bigint | number; repeatVisitors: bigint | number }>>`
      SELECT
        COALESCE(SUM(new_visitors), 0) AS newVisitors,
        COALESCE(SUM(repeat_visitors), 0) AS repeatVisitors
      FROM admin_dashboard_analytics_daily
      WHERE day_date >= DATE_SUB(UTC_DATE(), INTERVAL 30 DAY)
    `.catch(() => []),
    prisma.$queryRaw<Array<{ day: Date; count: bigint | number }>>`
      SELECT
        day_date AS day,
        registrations AS count
      FROM admin_dashboard_analytics_daily
      WHERE day_date >= DATE_SUB(UTC_DATE(), INTERVAL 30 DAY)
      ORDER BY day_date DESC
      LIMIT 30
    `.catch(() => []),
    prisma.$queryRaw<Array<{
      totalPageViews: bigint | number;
      totalVideoViews: bigint | number;
      uniqueVisitors: bigint | number;
      totalSessions: bigint | number;
    }>>`
      SELECT
        COALESCE(SUM(page_views), 0) AS totalPageViews,
        COALESCE(SUM(video_views), 0) AS totalVideoViews,
        COALESCE(SUM(unique_visitors), 0) AS uniqueVisitors,
        COALESCE(SUM(total_sessions), 0) AS totalSessions
      FROM admin_dashboard_analytics_daily
      WHERE day_date >= DATE_SUB(UTC_DATE(), INTERVAL 30 DAY)
    `.catch(() => []),
    prisma.$queryRaw<GeoVisitorRollupRow[]>`
      SELECT
        visitor_id AS visitorId,
        avg_geo_lat AS lat,
        avg_geo_lng AS lng,
        event_count AS eventCount,
        last_seen_at AS lastSeenAt
      FROM admin_dashboard_geo_visitors
      ORDER BY last_seen_at DESC
      LIMIT 1000
    `.catch(() => []),
    prisma.$queryRaw<Array<{ earliestAt: Date | null }>>`
      SELECT MIN(day_date) AS earliestAt
      FROM admin_dashboard_analytics_daily
    `.catch(() => []),
    prisma.$queryRaw<Array<{ earliestAt: Date | null }>>`
      SELECT MIN(day_date) AS earliestAt
      FROM admin_dashboard_analytics_daily
      WHERE auth_events > 0
    `.catch(() => []),
    prisma.$queryRaw<DailyAnalyticsRollupRow[]>`
      SELECT
        day_date AS day,
        page_views AS pageViews,
        video_views AS videoViews,
        unique_visitors AS uniqueVisitors,
        return_visits AS returnVisits,
        new_visitors AS newVisitors,
        repeat_visitors AS repeatVisitors,
        total_sessions AS totalSessions,
        auth_events AS authEvents,
        registrations AS registrations
      FROM admin_dashboard_analytics_daily
      ORDER BY day_date ASC
    `.catch(() => []),
  ]);

  return {
    analyticsDaily,
    hourlyRecentAnalytics,
    hourlyRecentAuth,
    analyticsNewVsRepeat,
    registrationsPerDay,
    analyticsTotals,
    geoVisitors,
    earliestAnalyticsAt,
    earliestAuthAt,
    dailySeriesRows,
  };
}
