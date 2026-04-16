import fs from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { buildAdminHealthPayload, readAdminHostMetricHistory } from "@/lib/admin-dashboard-health";
import { prisma } from "@/lib/db";

function toNumber(value: bigint | number | null | undefined) {
  if (typeof value === "bigint") {
    return Number(value);
  }

  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toIsoBucketStart(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const normalized = String(value).replace(" ", "T");
  const withZone = normalized.endsWith("Z") ? normalized : `${normalized}Z`;
  return new Date(withZone).toISOString();
}

const ADMIN_DASHBOARD_CACHE_TTL_MS = 30_000;
let adminDashboardCache: {
  expiresAt: number;
  payload: Record<string, unknown>;
} | null = null;


export async function GET(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const now = Date.now();
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";

  if (!forceRefresh && adminDashboardCache && adminDashboardCache.expiresAt > now) {
    return NextResponse.json(adminDashboardCache.payload);
  }

  const startedAt = now;

  const { health } = await buildAdminHealthPayload();

  const [users, videos, artists, categories] = await Promise.all([
    prisma.user.count().catch(() => 0),
    prisma.video.count().catch(() => 0),
    prisma.artist.count().catch(() => 0),
    prisma.genreCard.count().catch(() => 0),
  ]);

  const locations = await prisma.$queryRaw<Array<{ location: string; count: bigint | number }>>`
    SELECT location, COUNT(*) AS count
    FROM users
    WHERE location IS NOT NULL
      AND TRIM(location) <> ''
    GROUP BY location
    ORDER BY COUNT(*) DESC
    LIMIT 20
  `.catch(() => []);

  const traffic = await prisma.$queryRaw<Array<{ day: Date; count: bigint | number }>>`
    SELECT DATE(created_at) AS day, COUNT(*) AS count
    FROM auth_audit_logs
    WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
    GROUP BY DATE(created_at)
    ORDER BY day DESC
    LIMIT 14
  `.catch(() => []);

  const [auth24h, actionBreakdown, metadataQuality, ingestVelocity, groqDailySpend] = await Promise.all([
    prisma.$queryRaw<Array<{
      total: bigint | number;
      success: bigint | number;
      failed: bigint | number;
      uniqueIps: bigint | number;
      uniqueUsers: bigint | number;
    }>>`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed,
        COUNT(DISTINCT NULLIF(TRIM(ip_address), '')) AS uniqueIps,
        COUNT(DISTINCT user_id) AS uniqueUsers
      FROM auth_audit_logs
      WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
    `.catch(() => []),
    prisma.$queryRaw<Array<{ action: string; total: bigint | number; failed: bigint | number }>>`
      SELECT
        action,
        COUNT(*) AS total,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed
      FROM auth_audit_logs
      WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
      GROUP BY action
      ORDER BY total DESC
      LIMIT 8
    `.catch(() => []),
    prisma.$queryRaw<Array<{
      availableVideos: bigint | number;
      checkFailedEntries: bigint | number;
      missingMetadata: bigint | number;
      lowConfidence: bigint | number;
      unknownType: bigint | number;
    }>>`
      SELECT
        COUNT(DISTINCT CASE WHEN sv.status = 'available' THEN v.id END) AS availableVideos,
        COUNT(DISTINCT CASE WHEN sv.status = 'check-failed' THEN v.id END) AS checkFailedEntries,
        SUM(CASE WHEN v.parsedArtist IS NULL OR TRIM(v.parsedArtist) = '' OR v.parsedTrack IS NULL OR TRIM(v.parsedTrack) = '' THEN 1 ELSE 0 END) AS missingMetadata,
        SUM(CASE WHEN v.parseConfidence IS NULL OR v.parseConfidence < 0.80 THEN 1 ELSE 0 END) AS lowConfidence,
        SUM(CASE WHEN v.parsedVideoType IS NULL OR v.parsedVideoType = '' OR v.parsedVideoType = 'unknown' THEN 1 ELSE 0 END) AS unknownType
      FROM videos v
      LEFT JOIN site_videos sv ON sv.video_id = v.id
    `.catch(() => []),
    prisma.$queryRaw<Array<{ day: Date; count: bigint | number }>>`
      SELECT DATE(createdAt) AS day, COUNT(*) AS count
      FROM videos
      WHERE createdAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
      GROUP BY DATE(createdAt)
      ORDER BY day DESC
      LIMIT 14
    `.catch(() => []),
    prisma.$queryRaw<Array<{ day: Date; classified: bigint | number; errors: bigint | number }>>`
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

  const [analyticsDaily, analyticsHourly, analyticsNewVsRepeat, registrationsPerDay, analyticsTotals, hostMetricHistory] = await Promise.all([
    prisma.$queryRaw<Array<{
      day: Date;
      pageViews: bigint | number;
      videoViews: bigint | number;
      uniqueVisitors: bigint | number;
    }>>`
      SELECT
        DATE(created_at) AS day,
        SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS pageViews,
        SUM(CASE WHEN event_type = 'video_view' THEN 1 ELSE 0 END) AS videoViews,
        COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_id END) AS uniqueVisitors
      FROM analytics_events
      WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at)
      ORDER BY day DESC
      LIMIT 30
    `.catch(() => []),
    prisma.$queryRaw<Array<{
      bucketStart: Date | string;
      pageViews: bigint | number;
      videoViews: bigint | number;
      uniqueVisitors: bigint | number;
      authEvents: bigint | number;
    }>>`
      WITH RECURSIVE hour_buckets AS (
        SELECT
          DATE_FORMAT(DATE_SUB(DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:00:00'), INTERVAL 23 HOUR), '%Y-%m-%d %H:00:00') AS bucket_start,
          0 AS step
        UNION ALL
        SELECT
          DATE_FORMAT(DATE_ADD(bucket_start, INTERVAL 1 HOUR), '%Y-%m-%d %H:00:00') AS bucket_start,
          step + 1
        FROM hour_buckets
        WHERE step < 23
      )
      SELECT
        hb.bucket_start AS bucketStart,
        COALESCE(a.pageViews, 0) AS pageViews,
        COALESCE(a.videoViews, 0) AS videoViews,
        COALESCE(a.uniqueVisitors, 0) AS uniqueVisitors,
        COALESCE(t.authEvents, 0) AS authEvents
      FROM hour_buckets hb
      LEFT JOIN (
        SELECT
          DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') AS bucket_start,
          SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS pageViews,
          SUM(CASE WHEN event_type = 'video_view' THEN 1 ELSE 0 END) AS videoViews,
          COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_id END) AS uniqueVisitors
        FROM analytics_events
        WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')
      ) a ON a.bucket_start = hb.bucket_start
      LEFT JOIN (
        SELECT
          DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') AS bucket_start,
          COUNT(*) AS authEvents
        FROM auth_audit_logs
        WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')
      ) t ON t.bucket_start = hb.bucket_start
      ORDER BY hb.bucket_start ASC
    `.catch(() => []),
    prisma.$queryRaw<Array<{ newVisitors: bigint | number; repeatVisitors: bigint | number }>>`
      SELECT
        SUM(CASE WHEN is_new_visitor = 1 THEN 1 ELSE 0 END) AS newVisitors,
        SUM(CASE WHEN is_new_visitor = 0 THEN 1 ELSE 0 END) AS repeatVisitors
      FROM analytics_events
      WHERE event_type = 'page_view'
        AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
    `.catch(() => []),
    prisma.$queryRaw<Array<{ day: Date; count: bigint | number }>>`
      SELECT DATE(created_at) AS day, COUNT(*) AS count
      FROM users
      WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at)
      ORDER BY day DESC
      LIMIT 30
    `.catch(() => []),
    prisma.$queryRaw<Array<{
      totalPageViews: bigint | number;
      totalVideoViews: bigint | number;
      uniqueVisitors: bigint | number;
      totalSessions: bigint | number;
    }>>`
      SELECT
        SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS totalPageViews,
        SUM(CASE WHEN event_type = 'video_view' THEN 1 ELSE 0 END) AS totalVideoViews,
        COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_id END) AS uniqueVisitors,
        COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN session_id END) AS totalSessions
      FROM analytics_events
      WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
    `.catch(() => []),
    readAdminHostMetricHistory(),
  ]);

  const wikiCacheCount = await (async () => {
    try {
      const cacheDir = path.join(process.cwd(), ".cache", "artist-wiki");
      const files = await fs.readdir(cacheDir);
      return files.filter((f) => f.endsWith(".json")).length;
    } catch {
      return 0;
    }
  })();

  const auth24hRow = auth24h[0];
  const metadataRow = metadataQuality[0];

  const payload = {
    ok: true,
    meta: {
      durationMs: Date.now() - startedAt,
      generatedAt: new Date().toISOString(),
    },
    health,
    counts: {
      users,
      videos,
      artists,
      categories,
    },
    locations: locations.map((row) => ({
      location: row.location,
      count: toNumber(row.count),
    })),
    traffic: traffic.map((row) => ({
      day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day),
      count: toNumber(row.count),
    })),
    analytics: {
      daily: analyticsDaily.map((row) => ({
        day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day),
        pageViews: toNumber(row.pageViews),
        videoViews: toNumber(row.videoViews),
        uniqueVisitors: toNumber(row.uniqueVisitors),
      })),
      hourly: analyticsHourly.map((row) => ({
        bucketStart: toIsoBucketStart(row.bucketStart),
        pageViews: toNumber(row.pageViews),
        videoViews: toNumber(row.videoViews),
        uniqueVisitors: toNumber(row.uniqueVisitors),
        authEvents: toNumber(row.authEvents),
      })),
      newVsRepeat: {
        newVisitors: toNumber(analyticsNewVsRepeat[0]?.newVisitors),
        repeatVisitors: toNumber(analyticsNewVsRepeat[0]?.repeatVisitors),
      },
      registrationsPerDay: registrationsPerDay.map((row) => ({
        day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day),
        count: toNumber(row.count),
      })),
      totals: {
        pageViews: toNumber(analyticsTotals[0]?.totalPageViews),
        videoViews: toNumber(analyticsTotals[0]?.totalVideoViews),
        uniqueVisitors: toNumber(analyticsTotals[0]?.uniqueVisitors),
        sessions: toNumber(analyticsTotals[0]?.totalSessions),
      },
    },
    hostMetrics: {
      minute: hostMetricHistory,
    },
    insights: {
      auth24h: {
        total: toNumber(auth24hRow?.total),
        success: toNumber(auth24hRow?.success),
        failed: toNumber(auth24hRow?.failed),
        uniqueIps: toNumber(auth24hRow?.uniqueIps),
        uniqueUsers: toNumber(auth24hRow?.uniqueUsers),
      },
      authActionBreakdown: actionBreakdown.map((row) => ({
        action: row.action,
        total: toNumber(row.total),
        failed: toNumber(row.failed),
      })),
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

  adminDashboardCache = {
    expiresAt: Date.now() + ADMIN_DASHBOARD_CACHE_TTL_MS,
    payload,
  };

  return NextResponse.json(payload);
}
