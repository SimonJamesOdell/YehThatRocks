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
  earliestAnalyticsAt: Array<{ earliestAt: Date | null }>;
  earliestAuthAt: Array<{ earliestAt: Date | null }>;
  dailySeriesRows: DailyAnalyticsRollupRow[];
};

const ROLLUP_INTERVAL_MS = Math.max(30_000, Number(process.env.ADMIN_DASHBOARD_ROLLUP_INTERVAL_MS || "60000"));
const DAILY_RECENT_DAYS = 45;
const HOURLY_RECENT_DAYS = 21;
const DAILY_RETENTION_DAYS = 365 * 8;
const HOURLY_RETENTION_DAYS = 35;

let rollupsStarted = false;
let rollupsInFlight: Promise<void> | null = null;
let rollupsLastRefreshedAtMs = 0;
let dailyBackfillDone = false;

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
}

async function maybeBackfillDailyHistory() {
  if (dailyBackfillDone) return;

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
      LEFT JOIN (
        SELECT DATE(created_at) AS day_date, COUNT(*) AS registrations
        FROM users
        GROUP BY DATE(created_at)
      ) reg ON reg.day_date = metrics.day_date
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

async function refreshRecentDailyRollups() {
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
      WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${DAILY_RECENT_DAYS} DAY)
      GROUP BY DATE(created_at)
    ) metrics
    LEFT JOIN (
      SELECT DATE(created_at) AS day_date, COUNT(*) AS auth_events
      FROM auth_audit_logs
      WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${DAILY_RECENT_DAYS} DAY)
      GROUP BY DATE(created_at)
    ) auth ON auth.day_date = metrics.day_date
    LEFT JOIN (
      SELECT DATE(created_at) AS day_date, COUNT(*) AS registrations
      FROM users
      WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${DAILY_RECENT_DAYS} DAY)
      GROUP BY DATE(created_at)
    ) reg ON reg.day_date = metrics.day_date
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

async function refreshRecentHourlyRollups() {
  await prisma.$executeRawUnsafe(`
    INSERT INTO admin_dashboard_analytics_hourly (
      bucket_start,
      page_views,
      video_views,
      unique_visitors,
      return_visits
    )
    SELECT
      STR_TO_DATE(DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00'), '%Y-%m-%d %H:%i:%s') AS bucket_start,
      SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
      SUM(CASE WHEN event_type = 'video_view' THEN 1 ELSE 0 END) AS video_views,
      COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_id END) AS unique_visitors,
      COUNT(DISTINCT CASE WHEN event_type = 'page_view' AND is_new_visitor = 0 THEN visitor_id END) AS return_visits
    FROM analytics_events
    WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${HOURLY_RECENT_DAYS} DAY)
    GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')
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
      STR_TO_DATE(DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00'), '%Y-%m-%d %H:%i:%s') AS bucket_start,
      COUNT(*) AS auth_events
    FROM auth_audit_logs
    WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${HOURLY_RECENT_DAYS} DAY)
    GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')
    ON DUPLICATE KEY UPDATE
      auth_events = VALUES(auth_events),
      updated_at = CURRENT_TIMESTAMP(3)
  `);
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

async function refreshRollupsNow() {
  await ensureRollupTables();
  await maybeBackfillDailyHistory();
  await refreshRecentDailyRollups();
  await refreshRecentHourlyRollups();
  await pruneOldRollupRows();
  rollupsLastRefreshedAtMs = Date.now();
}

export async function ensureAdminDashboardRollupsFresh(options?: { force?: boolean }) {
  const force = Boolean(options?.force);
  if (!force && Date.now() - rollupsLastRefreshedAtMs < ROLLUP_INTERVAL_MS) {
    return;
  }

  if (!rollupsInFlight) {
    rollupsInFlight = refreshRollupsNow().finally(() => {
      rollupsInFlight = null;
    });
  }

  await rollupsInFlight;
}

export function startAdminDashboardRollups() {
  if (rollupsStarted || !process.env.DATABASE_URL) {
    return;
  }

  rollupsStarted = true;
  void ensureAdminDashboardRollupsFresh({ force: true }).catch(() => undefined);

  const timer = setInterval(() => {
    void ensureAdminDashboardRollupsFresh().catch(() => undefined);
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
    earliestAnalyticsAt,
    earliestAuthAt,
    dailySeriesRows,
  };
}
