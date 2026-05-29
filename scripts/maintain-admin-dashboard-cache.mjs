/**
 * Maintain admin dashboard cache — runs as a separate cronjob or scheduled task.
 * Computes all dashboard data and stores it in a simple cache table.
 * This is completely decoupled from request handlers and can't interfere with UX.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let prisma;

function toNumber(value) {
  if (typeof value === "bigint") return Number(value);
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

async function ensureAdminDashboardCacheTable() {
  // Create a single table to store the complete dashboard payload
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS admin_dashboard_cache (
      id INT PRIMARY KEY DEFAULT 1,
      payload LONGTEXT NOT NULL,
      computed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      CONSTRAINT only_one_row CHECK (id = 1)
    )
  `);
}

// ---------------------------------------------------------------------------
// Rollup table maintenance — runs in the external scheduler process only.
// Keeping this outside the Next.js app prevents health-stream ticks from
// triggering dashboard re-renders while rollups are being written.
// ---------------------------------------------------------------------------

const HOURLY_BUCKET_GROUP_BY_EXPR = "DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')";
const HOURLY_BUCKET_SELECT_EXPR = `STR_TO_DATE(${HOURLY_BUCKET_GROUP_BY_EXPR}, '%Y-%m-%d %H:%i:%s')`;

async function ensureRollupTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS admin_dashboard_analytics_daily (
      day_date DATE NOT NULL,
      page_views BIGINT NOT NULL DEFAULT 0,
      video_views BIGINT NOT NULL DEFAULT 0,
      unique_visitors BIGINT NOT NULL DEFAULT 0,
      return_visits BIGINT NOT NULL DEFAULT 0,
      magazine_external_landings BIGINT NOT NULL DEFAULT 0,
      new_visitors BIGINT NOT NULL DEFAULT 0,
      repeat_visitors BIGINT NOT NULL DEFAULT 0,
      total_sessions BIGINT NOT NULL DEFAULT 0,
      auth_events BIGINT NOT NULL DEFAULT 0,
      registrations BIGINT NOT NULL DEFAULT 0,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (day_date)
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
      PRIMARY KEY (bucket_start)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS admin_dashboard_auth_hourly (
      bucket_start DATETIME(0) NOT NULL,
      auth_events BIGINT NOT NULL DEFAULT 0,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (bucket_start)
    )
  `);
}

async function getUsersCreatedAtColumn() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT column_name AS columnName
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'users'
      AND column_name IN ('created_at', 'createdAt')
    ORDER BY CASE column_name WHEN 'created_at' THEN 0 ELSE 1 END
    LIMIT 1
  `).catch(() => []);
  return rows[0]?.columnName ?? null;
}

async function getMagazineLandingsTableExists() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS count
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'magazine_article_external_landings'
  `).catch(() => []);
  return Number(rows[0]?.count ?? 0) > 0;
}

async function refreshRollupTables() {
  await ensureRollupTables();

  const usersCreatedAtColumn = await getUsersCreatedAtColumn();
  const hasMagazineLandings = await getMagazineLandingsTableExists();

  const registrationsDailyJoinSql = usersCreatedAtColumn
    ? `
      LEFT JOIN (
        SELECT DATE(${usersCreatedAtColumn}) AS day_date, COUNT(*) AS registrations
        FROM users
        WHERE ${usersCreatedAtColumn} >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 45 DAY)
        GROUP BY DATE(${usersCreatedAtColumn})
      ) reg ON reg.day_date = metrics.day_date
    `
    : `
      LEFT JOIN (SELECT NULL AS day_date, 0 AS registrations WHERE 1 = 0) reg ON reg.day_date = metrics.day_date
    `;

  const magazineLandingsDailyJoinSql = hasMagazineLandings
    ? `
      LEFT JOIN (
        SELECT DATE(landed_at) AS day_date, COUNT(*) AS magazine_external_landings
        FROM magazine_article_external_landings
        WHERE landed_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 45 DAY)
        GROUP BY DATE(landed_at)
      ) mag_landings ON mag_landings.day_date = metrics.day_date
    `
    : `
      LEFT JOIN (SELECT NULL AS day_date, 0 AS magazine_external_landings WHERE 1 = 0) mag_landings ON mag_landings.day_date = metrics.day_date
    `;

  // Refresh last 45 days of daily rollups from raw analytics_events
  await prisma.$executeRawUnsafe(`
    INSERT INTO admin_dashboard_analytics_daily (
      day_date, page_views, video_views, unique_visitors, return_visits,
      magazine_external_landings, new_visitors, repeat_visitors,
      total_sessions, auth_events, registrations
    )
    SELECT
      metrics.day_date,
      metrics.page_views,
      metrics.video_views,
      metrics.unique_visitors,
      metrics.return_visits,
      COALESCE(mag_landings.magazine_external_landings, 0),
      metrics.new_visitors,
      metrics.repeat_visitors,
      metrics.total_sessions,
      COALESCE(auth.auth_events, 0),
      COALESCE(reg.registrations, 0)
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
      WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 45 DAY)
      GROUP BY DATE(created_at)
    ) metrics
    LEFT JOIN (
      SELECT DATE(created_at) AS day_date, COUNT(*) AS auth_events
      FROM auth_audit_logs
      WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 45 DAY)
      GROUP BY DATE(created_at)
    ) auth ON auth.day_date = metrics.day_date
    ${registrationsDailyJoinSql}
    ${magazineLandingsDailyJoinSql}
    ON DUPLICATE KEY UPDATE
      page_views = VALUES(page_views),
      video_views = VALUES(video_views),
      unique_visitors = VALUES(unique_visitors),
      return_visits = VALUES(return_visits),
      magazine_external_landings = VALUES(magazine_external_landings),
      new_visitors = VALUES(new_visitors),
      repeat_visitors = VALUES(repeat_visitors),
      total_sessions = VALUES(total_sessions),
      auth_events = VALUES(auth_events),
      registrations = VALUES(registrations),
      updated_at = CURRENT_TIMESTAMP(3)
  `);

  // Refresh last 72 hours of hourly analytics rollups
  await prisma.$executeRawUnsafe(`
    INSERT INTO admin_dashboard_analytics_hourly (
      bucket_start,
      page_views,
      video_views,
      unique_visitors,
      return_visits
    )
    SELECT
      bucket_start,
      SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
      SUM(CASE WHEN event_type = 'video_view' THEN 1 ELSE 0 END) AS video_views,
      COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_id END) AS unique_visitors,
      COUNT(DISTINCT CASE WHEN event_type = 'page_view' AND is_new_visitor = 0 THEN visitor_id END) AS return_visits
    FROM (
      SELECT
        ${HOURLY_BUCKET_SELECT_EXPR} AS bucket_start,
        event_type,
        visitor_id,
        is_new_visitor
      FROM analytics_events
      WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 72 HOUR)
    ) analytics_events_by_hour
    GROUP BY bucket_start
    ON DUPLICATE KEY UPDATE
      page_views = VALUES(page_views),
      video_views = VALUES(video_views),
      unique_visitors = VALUES(unique_visitors),
      return_visits = VALUES(return_visits),
      updated_at = CURRENT_TIMESTAMP(3)
  `);

  // Refresh last 72 hours of hourly auth rollups
  await prisma.$executeRawUnsafe(`
    INSERT INTO admin_dashboard_auth_hourly (bucket_start, auth_events)
    SELECT
      bucket_start,
      COUNT(*) AS auth_events
    FROM (
      SELECT
        ${HOURLY_BUCKET_SELECT_EXPR} AS bucket_start
      FROM auth_audit_logs
      WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 72 HOUR)
    ) auth_audit_logs_by_hour
    GROUP BY bucket_start
    ON DUPLICATE KEY UPDATE
      auth_events = VALUES(auth_events),
      updated_at = CURRENT_TIMESTAMP(3)
  `);

  // Prune stale hourly rows older than 35 days
  await Promise.all([
    prisma.$executeRawUnsafe(`DELETE FROM admin_dashboard_analytics_hourly WHERE bucket_start < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 35 DAY)`),
    prisma.$executeRawUnsafe(`DELETE FROM admin_dashboard_auth_hourly WHERE bucket_start < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 35 DAY)`),
  ]);
}

async function computeAdminDashboardData() {
  const startedAt = Date.now();

  const [userCounts, videos, artists, categories, hourlyAnalyticsRows, hourlyAuthRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS users,
        SUM(CASE WHEN email IS NOT NULL AND TRIM(email) <> '' THEN 1 ELSE 0 END) AS registeredUsers,
        SUM(CASE WHEN email IS NULL OR TRIM(email) = '' THEN 1 ELSE 0 END) AS anonymousUsers
      FROM users
    `.catch(() => []),
    prisma.video.count().catch(() => 0),
    prisma.artist.count().catch(() => 0),
    prisma.genreCard.count().catch(() => 0),
    prisma.$queryRaw`
      SELECT
        bucket_start AS bucketStart,
        page_views AS pageViews,
        video_views AS videoViews,
        unique_visitors AS uniqueVisitors,
        return_visits AS returnVisits
      FROM admin_dashboard_analytics_hourly
      WHERE bucket_start >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 72 HOUR)
      ORDER BY bucket_start ASC
    `.catch(() => []),
    prisma.$queryRaw`
      SELECT
        bucket_start AS bucketStart,
        auth_events AS authEvents
      FROM admin_dashboard_auth_hourly
      WHERE bucket_start >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 72 HOUR)
      ORDER BY bucket_start ASC
    `.catch(() => []),
  ]);

  const users = toNumber(userCounts[0]?.users);
  const registeredUsers = toNumber(userCounts[0]?.registeredUsers);
  const anonymousUsers = toNumber(userCounts[0]?.anonymousUsers);

  // Merge hourly analytics/auth into dashboard-compatible buckets
  function toIsoString(value) {
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  function toSafeNumber(value) {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
  }
  const authByBucketStart = new Map();
  const analyticsByBucketStart = new Map();
  const bucketStarts = new Set();
  for (const row of hourlyAuthRows) {
    const bucketStartIso = toIsoString(row.bucketStart);
    if (!bucketStartIso) continue;
    authByBucketStart.set(bucketStartIso, toSafeNumber(row.authEvents));
    bucketStarts.add(bucketStartIso);
  }
  for (const row of hourlyAnalyticsRows) {
    const bucketStartIso = toIsoString(row.bucketStart);
    if (!bucketStartIso) continue;
    analyticsByBucketStart.set(bucketStartIso, {
      pageViews: toSafeNumber(row.pageViews),
      videoViews: toSafeNumber(row.videoViews),
      uniqueVisitors: toSafeNumber(row.uniqueVisitors),
      returnVisits: toSafeNumber(row.returnVisits),
      magazineExternalLandings: toSafeNumber(row.magazineExternalLandings),
    });
    bucketStarts.add(bucketStartIso);
  }
  const hourlyRecent = Array.from(bucketStarts)
    .map((bucketStartIso) => {
      const analytics = analyticsByBucketStart.get(bucketStartIso);
      return {
        bucketStart: bucketStartIso,
        pageViews: analytics?.pageViews ?? 0,
        videoViews: analytics?.videoViews ?? 0,
        uniqueVisitors: analytics?.uniqueVisitors ?? 0,
        returnVisits: analytics?.returnVisits ?? 0,
        magazineExternalLandings: analytics?.magazineExternalLandings ?? 0,
        authEvents: authByBucketStart.get(bucketStartIso) ?? 0,
      };
    })
    .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));

  const locations = await prisma.$queryRaw`
    SELECT location, COUNT(*) AS count
    FROM users
    WHERE location IS NOT NULL
      AND TRIM(location) <> ''
    GROUP BY location
    ORDER BY COUNT(*) DESC
    LIMIT 20
  `.catch(() => []);

  const [authAuditCounters, metadataQuality, ingestVelocity, groqDailySpend] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed,
        COUNT(DISTINCT ip_address) AS uniqueIps,
        COUNT(DISTINCT user_id) AS uniqueUsers
      FROM auth_audit_logs
      WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)
    `.catch(() => []),
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS availableVideos,
        SUM(CASE WHEN parseMethod IS NULL OR parseMethod = '' THEN 1 ELSE 0 END) AS checkFailedEntries,
        SUM(CASE WHEN parseMethod IS NULL OR (
          parseMethod <> 'groq-llm-artist-inference'
          AND parseMethod <> 'groq-llm-track-inference'
          AND parseMethod <> 'groq-llm-album-inference'
          AND parseMethod <> 'groq-llm-live-inference'
          AND parseMethod <> 'groq-error'
        ) THEN 1 ELSE 0 END) AS missingMetadata,
        SUM(CASE WHEN parseConfidence < 0.5 AND parseConfidence > 0 THEN 1 ELSE 0 END) AS lowConfidence,
        SUM(CASE WHEN parsedVideoType = 'unknown-type' THEN 1 ELSE 0 END) AS unknownType
      FROM videos
    `.catch(() => []),
    prisma.$queryRaw`
      SELECT DATE(createdAt) AS day, COUNT(*) AS count
      FROM videos
      WHERE createdAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
      GROUP BY DATE(createdAt)
      ORDER BY day DESC
      LIMIT 14
    `.catch(() => []),
    prisma.$queryRaw`
      SELECT
        DATE(parsedAt) AS day,
        SUM(CASE WHEN parseMethod LIKE 'groq-llm%' THEN 1 ELSE 0 END) AS classified,
        SUM(CASE WHEN parseMethod = 'groq-error' THEN 1 ELSE 0 END) AS errors
      FROM videos
      WHERE parseMethod LIKE 'groq%'
        AND parsedAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
      GROUP BY DATE(parsedAt)
      ORDER BY day DESC
      LIMIT 14
    `.catch(() => []),
  ]);

  const auth24hRow = authAuditCounters[0];
  const metadataRow = metadataQuality[0];

  // Compute analytics from pre-computed daily table
  const dailyAnalyticsRows = await prisma.$queryRaw`
    SELECT
      day_date AS day,
      page_views AS pageViews,
      video_views AS videoViews,
      unique_visitors AS uniqueVisitors,
      return_visits AS returnVisits,
      magazine_external_landings AS magazineExternalLandings,
      new_visitors AS newVisitors,
      repeat_visitors AS repeatVisitors,
      total_sessions AS totalSessions,
      auth_events AS authEvents,
      registrations
    FROM admin_dashboard_analytics_daily
    ORDER BY day_date ASC
  `.catch(() => []);

  const recentCutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentDailyRows = dailyAnalyticsRows.filter((row) => {
    const rowDate = row.day instanceof Date ? row.day : new Date(row.day);
    return rowDate.getTime() >= recentCutoffMs;
  });

  const wikiCacheCount = await (async () => {
    try {
      const cacheDir = path.join(__dirname, "..", "apps", "web", ".cache", "artist-wiki");
      const files = await fs.readdir(cacheDir).catch(() => []);
      return files.filter((f) => f.endsWith(".json")).length;
    } catch {
      return 0;
    }
  })();

  const payload = {
    ok: true,
    meta: {
      durationMs: Date.now() - startedAt,
      generatedAt: new Date().toISOString(),
      computedAtMs: Date.now(),
    },
    counts: {
      users,
      registeredUsers,
      anonymousUsers,
      videos,
      artists,
      categories,
    },
    locations: locations.map((row) => ({
      location: row.location,
      count: toNumber(row.count),
    })),
    analytics: {
      daily: recentDailyRows.map((row) => ({
        day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day),
        pageViews: toNumber(row.pageViews),
        videoViews: toNumber(row.videoViews),
        uniqueVisitors: toNumber(row.uniqueVisitors),
        returnVisits: toNumber(row.returnVisits),
        magazineExternalLandings: toNumber(row.magazineExternalLandings),
        authEvents: toNumber(row.authEvents),
      })),
      hourlyRecent,
      newVsRepeat: {
        newVisitors: recentDailyRows.reduce((sum, row) => sum + toNumber(row.newVisitors), 0),
        repeatVisitors: recentDailyRows.reduce((sum, row) => sum + toNumber(row.repeatVisitors), 0),
      },
      registrationsPerDay: recentDailyRows.map((row) => ({
        day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day),
        count: toNumber(row.registrations),
      })),
      totals: {
        pageViews: recentDailyRows.reduce((sum, row) => sum + toNumber(row.pageViews), 0),
        videoViews: recentDailyRows.reduce((sum, row) => sum + toNumber(row.videoViews), 0),
        uniqueVisitors: recentDailyRows.reduce((sum, row) => sum + toNumber(row.uniqueVisitors), 0),
        sessions: recentDailyRows.reduce((sum, row) => sum + toNumber(row.totalSessions), 0),
      },
    },
    insights: {
      auth24h: {
        total: toNumber(auth24hRow?.total),
        success: toNumber(auth24hRow?.success),
        failed: toNumber(auth24hRow?.failed),
        uniqueIps: toNumber(auth24hRow?.uniqueIps),
        uniqueUsers: toNumber(auth24hRow?.uniqueUsers),
      },
      metadataQuality: {
        availableVideos: toNumber(metadataRow?.availableVideos),
        checkFailedEntries: toNumber(metadataRow?.checkFailedEntries),
        missingMetadata: toNumber(metadataRow?.missingMetadata),
        lowConfidence: toNumber(metadataRow?.lowConfidence),
        unknownType: toNumber(metadataRow?.unknownType),
      },
      ingestVelocity: ingestVelocity.map((row) => ({
        day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day),
        count: toNumber(row.count),
      })),
      groqSpend: {
        wikiCacheCount,
        daily: groqDailySpend.map((row) => ({
          day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day),
          classified: toNumber(row.classified),
          errors: toNumber(row.errors),
        })),
      },
    },
  };

  return payload;
}

async function updateAdminDashboardCache() {
  const payload = await computeAdminDashboardData();
  const payloadJson = JSON.stringify(payload);

  // Insert or update the cache
  await prisma.$executeRawUnsafe(`
    INSERT INTO admin_dashboard_cache (id, payload, computed_at)
    VALUES (1, ?, UTC_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE
      payload = VALUES(payload),
      computed_at = VALUES(computed_at)
  `, payloadJson);

  console.log(`✓ Admin dashboard cache updated (${payloadJson.length} bytes)`);
  return payload;
}

export async function maintainAdminDashboardCache() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Cannot maintain admin dashboard cache without a database.");
  }

  prisma = new PrismaClient({
    adapter: new PrismaMariaDb(databaseUrl),
    errorFormat: "pretty",
  });

  try {
    console.log("Ensuring admin dashboard cache table...");
    await ensureAdminDashboardCacheTable();

    console.log("Refreshing analytics rollup tables...");
    await refreshRollupTables().catch((err) => {
      // Non-fatal: stale rollups are better than a failed cache write
      console.warn("Rollup refresh failed (non-fatal):", err?.message ?? err);
    });

    console.log("Computing and storing admin dashboard data...");
    const payload = await updateAdminDashboardCache();

    console.log(`Cache contains ${Object.keys(payload).length} top-level keys`);
    console.log(`✓ Admin dashboard cache maintenance complete`);
  } catch (error) {
    console.error("✗ Error maintaining admin dashboard cache:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    prisma = undefined;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void maintainAdminDashboardCache();
}
