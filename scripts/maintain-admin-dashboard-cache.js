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

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("✗ DATABASE_URL is not set. Cannot maintain admin dashboard cache without a database.");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(databaseUrl),
  errorFormat: "pretty",
});

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

async function computeAdminDashboardData() {
  const startedAt = Date.now();

  const [userCounts, videos, artists, categories] = await Promise.all([
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
  ]);

  const users = toNumber(userCounts[0]?.users);
  const registeredUsers = toNumber(userCounts[0]?.registeredUsers);
  const anonymousUsers = toNumber(userCounts[0]?.anonymousUsers);

  const locations = await prisma.$queryRaw`
    SELECT location, COUNT(*) AS count
    FROM users
    WHERE location IS NOT NULL
      AND TRIM(location) <> ''
    GROUP BY location
    ORDER BY COUNT(*) DESC
    LIMIT 20
  `.catch(() => []);

  const [authAuditCounters, metadataQuality, ingestVelocity, groqDailySpend, apiUsageDaily] = await Promise.all([
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
    prisma.$queryRaw`
      SELECT
        DATE(created_at) AS day,
        SUM(CASE WHEN provider = 'youtube' THEN 1 ELSE 0 END) AS youtubeCalls,
        SUM(CASE WHEN provider = 'youtube' THEN units ELSE 0 END) AS youtubeUnits,
        SUM(CASE WHEN provider = 'youtube' AND success = 0 THEN 1 ELSE 0 END) AS youtubeErrors,
        SUM(CASE WHEN provider = 'groq' THEN 1 ELSE 0 END) AS groqCalls,
        SUM(CASE WHEN provider = 'groq' THEN units ELSE 0 END) AS groqUnits,
        SUM(CASE WHEN provider = 'groq' AND success = 0 THEN 1 ELSE 0 END) AS groqErrors
      FROM external_api_usage_events
      WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
      GROUP BY DATE(created_at)
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

  // Get geo visitors
  const geoVisitors = (await prisma.$queryRaw`
    SELECT
      visitor_id AS visitorId,
      avg_geo_lat AS lat,
      avg_geo_lng AS lng,
      event_count AS eventCount,
      last_seen_at AS lastSeenAt
    FROM admin_dashboard_geo_visitors
    LIMIT 1000
  `.catch(() => [])).map((row) => ({
    visitorId: row.visitorId,
    lat: toNumber(row.lat),
    lng: toNumber(row.lng),
    eventCount: toNumber(row.eventCount),
    lastSeenAt: row.lastSeenAt instanceof Date ? row.lastSeenAt.toISOString() : String(row.lastSeenAt),
  }));

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
      })),
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
      geoVisitors,
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
      apiUsage: {
        daily: apiUsageDaily.map((row) => {
          const day = row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day);
          return {
            day,
            youtubeCalls: toNumber(row.youtubeCalls),
            youtubeUnits: toNumber(row.youtubeUnits),
            youtubeErrors: toNumber(row.youtubeErrors),
            groqCalls: toNumber(row.groqCalls),
            groqUnits: toNumber(row.groqUnits),
            groqErrors: toNumber(row.groqErrors),
          };
        }),
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

async function main() {
  try {
    console.log("Ensuring admin dashboard cache table...");
    await ensureAdminDashboardCacheTable();

    console.log("Computing and storing admin dashboard data...");
    const payload = await updateAdminDashboardCache();

    console.log(`Cache contains ${Object.keys(payload).length} top-level keys`);
    console.log(`✓ Admin dashboard cache maintenance complete`);
  } catch (error) {
    console.error("✗ Error maintaining admin dashboard cache:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
