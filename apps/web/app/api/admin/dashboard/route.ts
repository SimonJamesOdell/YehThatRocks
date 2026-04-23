import fs from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { buildAdminHealthPayload, readAdminHostMetricHistory } from "@/lib/admin-dashboard-health";
import { prisma } from "@/lib/db";

function toNumber(value: bigint | number | string | null | undefined) {
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

type AnalyticsSeriesBucket = {
  bucketStart: string;
  bucketEnd: string;
  label: string;
  pageViews: number;
  videoViews: number;
  uniqueVisitors: number;
  returnVisits: number;
  authEvents: number;
};

type VisitorGeoPoint = {
  visitorId: string;
  lat: number;
  lng: number;
  eventCount: number;
  lastSeenAt: string;
};

function addUtcMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function countMonthsInclusive(start: Date, end: Date) {
  return Math.max(1, ((end.getUTCFullYear() - start.getUTCFullYear()) * 12) + (end.getUTCMonth() - start.getUTCMonth()) + 1);
}

function formatDateLabel(date: Date) {
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatMonthLabel(date: Date) {
  return date.toLocaleDateString([], { month: "short", year: "numeric" });
}

function buildRangeLabel(start: Date, end: Date, mode: "daily" | "weekly" | "monthly" | "allTime", bucketMonths = 1) {
  if (mode === "daily") {
    return formatDateLabel(end);
  }

  if (mode === "weekly") {
    return `${formatDateLabel(start)} - ${formatDateLabel(end)}`;
  }

  if (mode === "monthly") {
    return formatMonthLabel(end);
  }

  if (bucketMonths <= 1) {
    return formatMonthLabel(end);
  }

  return `${formatMonthLabel(start)} - ${formatMonthLabel(end)}`;
}

async function readAnalyticsBucketMetrics(bucketStart: Date, bucketEnd: Date) {
  const [analyticsRows, authRows] = await Promise.all([
    prisma.$queryRaw<Array<{
      pageViews: bigint | number;
      videoViews: bigint | number;
      uniqueVisitors: bigint | number;
      returnVisits: bigint | number;
    }>>`
      SELECT
        SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS pageViews,
        SUM(CASE WHEN event_type = 'video_view' THEN 1 ELSE 0 END) AS videoViews,
        COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_id END) AS uniqueVisitors,
        COUNT(DISTINCT CASE WHEN event_type = 'page_view' AND is_new_visitor = 0 THEN visitor_id END) AS returnVisits
      FROM analytics_events
      WHERE created_at >= ${bucketStart}
        AND created_at < ${bucketEnd}
    `.catch(() => []),
    prisma.$queryRaw<Array<{ authEvents: bigint | number }>>`
      SELECT COUNT(*) AS authEvents
      FROM auth_audit_logs
      WHERE created_at >= ${bucketStart}
        AND created_at < ${bucketEnd}
    `.catch(() => []),
  ]);

  return {
    pageViews: toNumber(analyticsRows[0]?.pageViews),
    videoViews: toNumber(analyticsRows[0]?.videoViews),
    uniqueVisitors: toNumber(analyticsRows[0]?.uniqueVisitors),
    returnVisits: toNumber(analyticsRows[0]?.returnVisits),
    authEvents: toNumber(authRows[0]?.authEvents),
  };
}

async function buildRollingAnalyticsSeries(
  nowDate: Date,
  mode: "daily" | "weekly" | "monthly" | "allTime",
  options?: { bucketCount?: number; bucketMonths?: number },
): Promise<AnalyticsSeriesBucket[]> {
  const bucketCount = options?.bucketCount ?? 12;
  const bucketMonths = options?.bucketMonths ?? 1;

  const bucketDefs = Array.from({ length: bucketCount }, (_, index) => {
    const reverseIndex = bucketCount - index - 1;

    if (mode === "daily") {
      const bucketEnd = new Date(nowDate.getTime() - reverseIndex * 24 * 60 * 60 * 1000);
      const bucketStart = new Date(bucketEnd.getTime() - 24 * 60 * 60 * 1000);
      return { bucketStart, bucketEnd };
    }

    if (mode === "weekly") {
      const bucketEnd = new Date(nowDate.getTime() - reverseIndex * 7 * 24 * 60 * 60 * 1000);
      const bucketStart = new Date(bucketEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { bucketStart, bucketEnd };
    }

    const bucketEnd = addUtcMonths(nowDate, -(reverseIndex * bucketMonths));
    const bucketStart = addUtcMonths(bucketEnd, -bucketMonths);
    return { bucketStart, bucketEnd };
  });

  const metrics = await Promise.all(bucketDefs.map((bucket) => readAnalyticsBucketMetrics(bucket.bucketStart, bucket.bucketEnd)));

  return bucketDefs.map((bucket, index) => ({
    bucketStart: bucket.bucketStart.toISOString(),
    bucketEnd: bucket.bucketEnd.toISOString(),
    label: buildRangeLabel(bucket.bucketStart, bucket.bucketEnd, mode, bucketMonths),
    ...metrics[index],
  }));
}

const ADMIN_DASHBOARD_CACHE_TTL_MS = 30_000;
let adminDashboardCache: {
  expiresAt: number;
  payload: Record<string, unknown>;
} | null = null;

const METADATA_QUALITY_CACHE_TTL_MS = 5 * 60 * 1000;
let metadataQualityCache: {
  expiresAt: number;
  availableVideos: number;
  checkFailedEntries: number;
  missingMetadata: number;
  lowConfidence: number;
  unknownType: number;
} | null = null;
let metadataQualityCachePromise: Promise<{
  expiresAt: number;
  availableVideos: number;
  checkFailedEntries: number;
  missingMetadata: number;
  lowConfidence: number;
  unknownType: number;
}> | null = null;


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

  const [userCounts, videos, artists, categories] = await Promise.all([
    prisma.$queryRaw<Array<{
      users: bigint | number;
      registeredUsers: bigint | number;
      anonymousUsers: bigint | number;
    }>>`
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

  const [auth24h, actionBreakdown, metadataQuality, ingestVelocity, groqDailySpend, apiUsageDaily] = await Promise.all([
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
    (async () => {
      const cached = metadataQualityCache;
      if (cached && cached.expiresAt > Date.now()) {
        return [cached];
      }

      if (!metadataQualityCachePromise) {
        metadataQualityCachePromise = (async () => {
          // Split into two single-table queries — no join needed.
          // site_videos holds status; videos holds metadata columns.
          const [statusCounts, metaCounts] = await Promise.all([
            prisma.$queryRaw<Array<{
              availableVideos: bigint | number;
              checkFailedEntries: bigint | number;
            }>>`
              SELECT
                SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS availableVideos,
                SUM(CASE WHEN status = 'check-failed' THEN 1 ELSE 0 END) AS checkFailedEntries
              FROM site_videos
            `.catch(() => []),
            prisma.$queryRaw<Array<{
              missingMetadata: bigint | number;
              lowConfidence: bigint | number;
              unknownType: bigint | number;
            }>>`
              SELECT
                SUM(CASE WHEN parsedArtist IS NULL OR TRIM(parsedArtist) = '' OR parsedTrack IS NULL OR TRIM(parsedTrack) = '' THEN 1 ELSE 0 END) AS missingMetadata,
                SUM(CASE WHEN parseConfidence IS NULL OR parseConfidence < 0.80 THEN 1 ELSE 0 END) AS lowConfidence,
                SUM(CASE WHEN parsedVideoType IS NULL OR parsedVideoType = '' OR parsedVideoType = 'unknown' THEN 1 ELSE 0 END) AS unknownType
              FROM videos
            `.catch(() => []),
          ]);

          const result = {
            expiresAt: Date.now() + METADATA_QUALITY_CACHE_TTL_MS,
            availableVideos: toNumber(statusCounts[0]?.availableVideos),
            checkFailedEntries: toNumber(statusCounts[0]?.checkFailedEntries),
            missingMetadata: toNumber(metaCounts[0]?.missingMetadata),
            lowConfidence: toNumber(metaCounts[0]?.lowConfidence),
            unknownType: toNumber(metaCounts[0]?.unknownType),
          };
          metadataQualityCache = result;
          return result;
        })().finally(() => {
          metadataQualityCachePromise = null;
        });
      }

      return [await metadataQualityCachePromise];
    })(),
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
    prisma.$queryRaw<Array<{
      day: Date;
      youtubeCalls: bigint | number;
      youtubeUnits: bigint | number;
      youtubeErrors: bigint | number;
      groqCalls: bigint | number;
      groqUnits: bigint | number;
      groqErrors: bigint | number;
    }>>`
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

  const [analyticsDaily, hourlyRecentAnalytics, hourlyRecentAuth, analyticsNewVsRepeat, registrationsPerDay, analyticsTotals, geoVisitorsRaw, hostMetricHistory, earliestAnalyticsAt, earliestAuthAt] = await Promise.all([
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
      returnVisits: bigint | number;
    }>>`
      SELECT
        DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') AS bucketStart,
        SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS pageViews,
        SUM(CASE WHEN event_type = 'video_view' THEN 1 ELSE 0 END) AS videoViews,
        COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_id END) AS uniqueVisitors,
        COUNT(DISTINCT CASE WHEN event_type = 'page_view' AND is_new_visitor = 0 THEN visitor_id END) AS returnVisits
      FROM analytics_events
      WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
      GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')
      ORDER BY bucketStart ASC
    `.catch(() => []),
    prisma.$queryRaw<Array<{ bucketStart: Date | string; authEvents: bigint | number }>>`
      SELECT
        DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') AS bucketStart,
        COUNT(*) AS authEvents
      FROM auth_audit_logs
      WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
      GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')
      ORDER BY bucketStart ASC
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
    prisma.$queryRaw<Array<{
      visitorId: string;
      lat: bigint | number | string;
      lng: bigint | number | string;
      eventCount: bigint | number;
      lastSeenAt: Date;
    }>>`
      SELECT
        visitor_id AS visitorId,
        AVG(geo_lat) AS lat,
        AVG(geo_lng) AS lng,
        COUNT(*) AS eventCount,
        MAX(created_at) AS lastSeenAt
      FROM analytics_events
      WHERE geo_lat IS NOT NULL
        AND geo_lng IS NOT NULL
      GROUP BY visitor_id
      ORDER BY lastSeenAt DESC
      LIMIT 1000
    `.catch(() => []),
    readAdminHostMetricHistory(),
    prisma.$queryRaw<Array<{ earliestAt: Date | null }>>`
      SELECT MIN(created_at) AS earliestAt
      FROM analytics_events
    `.catch(() => []),
    prisma.$queryRaw<Array<{ earliestAt: Date | null }>>`
      SELECT MIN(created_at) AS earliestAt
      FROM auth_audit_logs
    `.catch(() => []),
  ]);

  const nowDate = new Date();
  const earliestCandidates = [earliestAnalyticsAt[0]?.earliestAt, earliestAuthAt[0]?.earliestAt].filter(
    (value): value is Date => value instanceof Date,
  );
  const earliestRecordAt = earliestCandidates.length > 0
    ? new Date(Math.min(...earliestCandidates.map((value) => value.getTime())))
    : null;
  const allTimeMonthSpan = earliestRecordAt ? countMonthsInclusive(earliestRecordAt, nowDate) : 1;
  const allTimeBucketMonths = Math.max(1, Math.ceil(allTimeMonthSpan / 12));
  const allTimeBucketCount = Math.min(12, Math.max(1, Math.ceil(allTimeMonthSpan / allTimeBucketMonths)));

  const [allTimeSeries, monthlySeries, weeklySeries, dailySeries] = await Promise.all([
    buildRollingAnalyticsSeries(nowDate, "allTime", { bucketCount: allTimeBucketCount, bucketMonths: allTimeBucketMonths }),
    buildRollingAnalyticsSeries(nowDate, "monthly", { bucketCount: 12, bucketMonths: 1 }),
    buildRollingAnalyticsSeries(nowDate, "weekly", { bucketCount: 12 }),
    buildRollingAnalyticsSeries(nowDate, "daily", { bucketCount: 12 }),
  ]);

  const authByHour = new Map(hourlyRecentAuth.map((row) => [toIsoBucketStart(row.bucketStart), toNumber(row.authEvents)]));
  const hourlyRecent = hourlyRecentAnalytics.map((row) => {
    const bucketStart = toIsoBucketStart(row.bucketStart);
    return {
      bucketStart,
      pageViews: toNumber(row.pageViews),
      videoViews: toNumber(row.videoViews),
      uniqueVisitors: toNumber(row.uniqueVisitors),
      returnVisits: toNumber(row.returnVisits),
      authEvents: authByHour.get(bucketStart) ?? 0,
    };
  });

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
  const geoVisitors: VisitorGeoPoint[] = geoVisitorsRaw
    .map((row) => {
      const lat = toNumber(row.lat);
      const lng = toNumber(row.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }

      return {
        visitorId: row.visitorId,
        lat,
        lng,
        eventCount: toNumber(row.eventCount),
        lastSeenAt: row.lastSeenAt instanceof Date ? row.lastSeenAt.toISOString() : new Date(row.lastSeenAt).toISOString(),
      };
    })
    .filter((row): row is VisitorGeoPoint => Boolean(row));

  const payload = {
    ok: true,
    meta: {
      durationMs: Date.now() - startedAt,
      generatedAt: new Date().toISOString(),
    },
    health,
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
      hourlyRecent,
      series: {
        allTime: allTimeSeries,
        monthly: monthlySeries,
        weekly: weeklySeries,
        daily: dailySeries,
      },
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
      geoVisitors,
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
      apiUsage: (() => {
        const groqClassifiedByDay = new Map(
          groqDailySpend.map((row) => [
            row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day),
            toNumber(row.classified),
          ]),
        );

        const daily = apiUsageDaily
          .map((row) => {
            const day = row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day);
            return {
              day,
              youtubeCalls: toNumber(row.youtubeCalls),
              youtubeUnits: toNumber(row.youtubeUnits),
              youtubeErrors: toNumber(row.youtubeErrors),
              groqCalls: toNumber(row.groqCalls),
              groqUnits: toNumber(row.groqUnits),
              groqErrors: toNumber(row.groqErrors),
              groqClassified: groqClassifiedByDay.get(day) ?? 0,
            };
          })
          .sort((a, b) => a.day.localeCompare(b.day));

        const totals7dRows = daily.slice(-7);
        const totals7d = totals7dRows.reduce(
          (acc, row) => {
            acc.youtubeCalls += row.youtubeCalls;
            acc.youtubeUnits += row.youtubeUnits;
            acc.youtubeErrors += row.youtubeErrors;
            acc.groqCalls += row.groqCalls;
            acc.groqUnits += row.groqUnits;
            acc.groqErrors += row.groqErrors;
            acc.groqClassified += row.groqClassified;
            return acc;
          },
          {
            youtubeCalls: 0,
            youtubeUnits: 0,
            youtubeErrors: 0,
            groqCalls: 0,
            groqUnits: 0,
            groqErrors: 0,
            groqClassified: 0,
          },
        );

        return {
          daily,
          totals7d: {
            ...totals7d,
            youtubeSuccessRate: totals7d.youtubeCalls > 0
              ? Number((((totals7d.youtubeCalls - totals7d.youtubeErrors) / totals7d.youtubeCalls) * 100).toFixed(1))
              : 100,
            groqSuccessRate: totals7d.groqCalls > 0
              ? Number((((totals7d.groqCalls - totals7d.groqErrors) / totals7d.groqCalls) * 100).toFixed(1))
              : 100,
          },
        };
      })(),
    },
  };

  adminDashboardCache = {
    expiresAt: Date.now() + ADMIN_DASHBOARD_CACHE_TTL_MS,
    payload,
  };

  return NextResponse.json(payload);
}
