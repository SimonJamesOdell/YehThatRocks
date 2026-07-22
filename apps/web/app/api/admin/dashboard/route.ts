import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiAuth } from "@/lib/admin-auth";
import { getMetadataQualityStats } from "@/lib/admin-metadata-quality";
import {
  FALLBACK_TTL_MS,
  getCachedDashboardResponsePayload,
  getDashboardResponseInFlight,
  setCachedDashboardResponsePayload,
  setDashboardResponseInFlight,
} from "@/lib/admin-dashboard-response-cache";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type UserCounterRow = {
  users?: bigint | number;
  registeredUsers?: bigint | number;
  anonymousUsers?: bigint | number;
};

function toSafeNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

async function loadLiveUserCounters() {
  const rows = await prisma.$queryRaw<UserCounterRow[]>`
    SELECT
      COUNT(*) AS users,
      SUM(CASE WHEN email IS NOT NULL AND TRIM(email) <> '' THEN 1 ELSE 0 END) AS registeredUsers,
      SUM(CASE WHEN email IS NULL OR TRIM(email) = '' THEN 1 ELSE 0 END) AS anonymousUsers
    FROM users
  `.catch(() => []);

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    users: toSafeNumber(row.users),
    registeredUsers: toSafeNumber(row.registeredUsers),
    anonymousUsers: toSafeNumber(row.anonymousUsers),
  };
}

type DashboardPayloadWithMeta = { payload: Record<string, unknown>; usedFallback: boolean };

type AudienceFrequencyRow = {
  days_visited: bigint | number;
  people: bigint | number;
};

type AudienceRetentionRow = {
  cohort_size: bigint | number;
  returned: bigint | number;
};

async function loadAudienceData() {
  const nowIso = new Date().toISOString();

  const [freqRows, retention7Rows, retention30Rows] = await Promise.all([
    prisma.$queryRaw<AudienceFrequencyRow[]>`
      SELECT days_visited, COUNT(*) AS people
      FROM (
        SELECT COALESCE(CAST(user_id AS CHAR), visitor_id) AS identity_val,
               COUNT(DISTINCT DATE(created_at)) AS days_visited
        FROM analytics_events
        WHERE event_type = 'page_view'
          AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
        GROUP BY identity_val
        HAVING days_visited > 1
      ) t
      GROUP BY days_visited
      ORDER BY days_visited ASC
    `.catch(() => []),
    // 7-day retention: of visitors who were NEW 7 days ago, how many came back in the 7 days since?
    prisma.$queryRaw<AudienceRetentionRow[]>`
      SELECT
        COUNT(DISTINCT cohort.identity_val) AS cohort_size,
        COUNT(DISTINCT returnees.identity_val) AS returned
      FROM (
        SELECT DISTINCT COALESCE(CAST(user_id AS CHAR), visitor_id) AS identity_val
        FROM analytics_events
        WHERE event_type = 'page_view'
          AND is_new_visitor = 1
          AND DATE(created_at) = DATE_SUB(UTC_DATE(), INTERVAL 7 DAY)
      ) cohort
      LEFT JOIN (
        SELECT DISTINCT COALESCE(CAST(user_id AS CHAR), visitor_id) AS identity_val
        FROM analytics_events
        WHERE event_type = 'page_view'
          AND is_new_visitor = 0
          AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
      ) returnees ON returnees.identity_val = cohort.identity_val
    `.catch(() => []),
    // 30-day retention: of visitors who were NEW 30 days ago, how many came back in the 30 days since?
    prisma.$queryRaw<AudienceRetentionRow[]>`
      SELECT
        COUNT(DISTINCT cohort.identity_val) AS cohort_size,
        COUNT(DISTINCT returnees.identity_val) AS returned
      FROM (
        SELECT DISTINCT COALESCE(CAST(user_id AS CHAR), visitor_id) AS identity_val
        FROM analytics_events
        WHERE event_type = 'page_view'
          AND is_new_visitor = 1
          AND DATE(created_at) = DATE_SUB(UTC_DATE(), INTERVAL 30 DAY)
      ) cohort
      LEFT JOIN (
        SELECT DISTINCT COALESCE(CAST(user_id AS CHAR), visitor_id) AS identity_val
        FROM analytics_events
        WHERE event_type = 'page_view'
          AND is_new_visitor = 0
          AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
      ) returnees ON returnees.identity_val = cohort.identity_val
    `.catch(() => []),
  ]);

  // Group raw days_visited rows into label buckets so each label appears once
  const groupedByLabel = new Map<string, { daysMin: number; daysMax: number; people: number }>();
  for (const row of freqRows) {
    const label = buildFrequencyLabel(Number(row.days_visited));
    const existing = groupedByLabel.get(label);
    if (existing) {
      existing.people += Number(row.people);
      existing.daysMin = Math.min(existing.daysMin, Number(row.days_visited));
      existing.daysMax = Math.max(existing.daysMax, Number(row.days_visited));
    } else {
      groupedByLabel.set(label, {
        daysMin: Number(row.days_visited),
        daysMax: Number(row.days_visited),
        people: Number(row.people),
      });
    }
  }

  const frequencyDistribution = Array.from(groupedByLabel.entries())
    .map(([label, data]) => ({
      label,
      daysMin: data.daysMin,
      daysMax: data.daysMax,
      people: data.people,
    }))
    .sort((a, b) => a.daysMin - b.daysMin);

  const retentionCohorts = [
    extractRetention(retention7Rows, "7-day"),
    extractRetention(retention30Rows, "30-day"),
  ];

  return {
    generatedAt: nowIso,
    frequencyDistribution,
    retentionCohorts,
  };
}

function buildFrequencyLabel(days: number): string {
  if (days === 1) return "1 day";
  if (days >= 2 && days <= 3) return "2–3 days";
  if (days >= 4 && days <= 7) return "4–7 days";
  if (days >= 8 && days <= 14) return "8–14 days";
  return "15+ days";
}

function extractRetention(rows: AudienceRetentionRow[], label: string) {
  const row = rows[0];
  if (!row) {
    return { label, cohortSize: 0, returned: 0, rate: 0 };
  }

  const cohortSize = Number(row.cohort_size);
  const returned = Number(row.returned);
  const rate = cohortSize > 0 ? Math.round((returned / cohortSize) * 100) : 0;

  return { label, cohortSize, returned, rate };
}

async function loadDashboardPayloadFromCacheTable(): Promise<DashboardPayloadWithMeta> {
  // Read from pre-computed cache table — no side effects, super fast
  const cacheRows = await prisma.$queryRaw<Array<{ payload: string; computed_at: Date }>>`
    SELECT payload, computed_at FROM admin_dashboard_cache WHERE id = 1
  `.catch(() => []);

  if (cacheRows.length === 0) {
    return { payload: createEmptyDashboardPayload(), usedFallback: false };
  }

  const cacheRow = cacheRows[0];
  const payload = normalizeDashboardPayload(JSON.parse(cacheRow.payload));
  payload.insights.metadataQuality = await getMetadataQualityStats();

  const liveUserCounters = await loadLiveUserCounters();
  if (liveUserCounters) {
    payload.counts = {
      ...payload.counts,
      users: liveUserCounters.users,
      registeredUsers: liveUserCounters.registeredUsers,
      anonymousUsers: liveUserCounters.anonymousUsers,
    };
  }

  let usedFallback = false;

  if (payload.analytics.hourlyRecent.length === 0) {
    const [hourlyAnalyticsRows, hourlyAuthRows] = await Promise.all([
      prisma.$queryRaw<HourlyAnalyticsRow[]>`
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
      prisma.$queryRaw<HourlyAuthRow[]>`
        SELECT
          bucket_start AS bucketStart,
          auth_events AS authEvents
        FROM admin_dashboard_auth_hourly
        WHERE bucket_start >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 72 HOUR)
        ORDER BY bucket_start ASC
      `.catch(() => []),
    ]);

    payload.analytics.hourlyRecent = buildHourlyRecentRows(hourlyAnalyticsRows, hourlyAuthRows);
    usedFallback = true;
  }

  (payload as Record<string, unknown>).audience = await loadAudienceData();

  return { payload: payload as Record<string, unknown>, usedFallback };
}

function createEmptyDashboardPayload() {
  const nowIso = new Date().toISOString();
  return {
    ok: true,
    meta: {
      durationMs: 0,
      generatedAt: nowIso,
      computedAtMs: Date.now(),
      warning: "Dashboard cache is not initialized yet; serving empty admin payload.",
    },
    health: {
      nodeUptimeSec: 0,
      memory: { rssMb: 0, heapUsedMb: 0, heapTotalMb: 0 },
      host: {
        platform: "unknown",
        loadAvg: [0, 0, 0],
        totalMemMb: 0,
        freeMemMb: 0,
        cpuUsagePercent: null,
        cpuAverageUsagePercent: null,
        cpuPeakCoreUsagePercent: null,
        memoryUsagePercent: 0,
        diskUsagePercent: null,
        swapUsagePercent: null,
        networkUsagePercent: null,
      },
    },
    counts: {
      users: 0,
      registeredUsers: 0,
      anonymousUsers: 0,
      videos: 0,
      artists: 0,
      categories: 0,
    },
    locations: [],
    traffic: [],
    analytics: {
      daily: [],
      hourlyRecent: [],
      series: {
        allTime: [],
        monthly: [],
        weekly: [],
        daily: [],
      },
      newVsRepeat: { newVisitors: 0, repeatVisitors: 0 },
      registrationsPerDay: [],
      totals: { pageViews: 0, videoViews: 0, uniqueVisitors: 0, sessions: 0 },
      engagement: {
        pagesPerSession: 0,
        videosPerSession: 0,
      },
    },
    audience: {
      generatedAt: nowIso,
      frequencyDistribution: [],
      retentionCohorts: [],
    },
    hostMetrics: { minute: [] },
    insights: {
      auth24h: { total: 0, success: 0, failed: 0, uniqueIps: 0, uniqueUsers: 0 },
      authActionBreakdown: [],
      metadataQuality: {
        availableVideos: 0,
        checkFailedEntries: 0,
        missingMetadata: 0,
        lowConfidence: 0,
        unknownType: 0,
      },
      ingestVelocity: [],
      activeHours: [],
      groqSpend: {
        wikiCacheCount: 0,
        daily: [],
      },
      memoryDiagnostics: {
        snapshotAt: nowIso,
        process: {
          rssMb: 0,
          heapUsedMb: 0,
          heapTotalMb: 0,
          externalMb: 0,
          arrayBuffersMb: 0,
        },
        caches: {
          currentVideo: {
            currentVideoCache: 0,
            currentVideoPendingCache: 0,
            currentVideoInflight: 0,
            currentVideoRelatedPoolCache: 0,
            currentVideoRelatedPoolInflight: 0,
          },
          artist: {
            limits: { defaultMaxEntries: 0, heavyMaxEntries: 0 },
            sizes: {
              artistNormVideoPoolCache: 0,
              artistNormVideoPoolInFlight: 0,
              sameGenreRelatedPoolCache: 0,
              sameGenreRelatedPoolInFlight: 0,
              artistLetterCache: 0,
              artistLetterPageCache: 0,
              artistSearchCache: 0,
              artistSingleSlugCache: 0,
              artistVideosCache: 0,
              artistVideosInFlight: 0,
            },
          },
          wikiCacheCount: 0,
        },
      },
    },
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asArray<T = unknown>(value: unknown, fallback: T[] = []): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

type AnalyticsSeriesBucket = {
  bucketStart: string;
  bucketEnd: string;
  label: string;
  pageViews: number;
  videoViews: number;
  uniqueVisitors: number;
  returnVisits: number;
  sessions: number;
  magazineExternalLandings: number;
  authEvents: number;
};

type HourlyAnalyticsRow = {
  bucketStart: Date | string;
  pageViews?: bigint | number;
  videoViews?: bigint | number;
  uniqueVisitors?: bigint | number;
  returnVisits?: bigint | number;
  magazineExternalLandings?: bigint | number;
};

type HourlyAuthRow = {
  bucketStart: Date | string;
  authEvents?: bigint | number;
};

function toUtcDayStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseIsoDay(day: string) {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfUtcWeek(date: Date) {
  const day = date.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  return addUtcDays(toUtcDayStart(date), -daysSinceMonday);
}

function toDayLabel(date: Date) {
  return date.toISOString().slice(0, 10);
}

function toMonthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function toWeekKey(date: Date) {
  return toDayLabel(startOfUtcWeek(date));
}

function aggregateSeriesBuckets(
  rows: AnalyticsSeriesBucket[],
  keyFn: (date: Date) => string,
  bucketStartFn: (date: Date) => Date,
  bucketEndFn: (start: Date) => Date,
  labelFn: (start: Date, end: Date) => string,
) {
  const aggregates = new Map<string, AnalyticsSeriesBucket>();

  for (const row of rows) {
    const bucketDate = new Date(row.bucketStart);
    if (!Number.isFinite(bucketDate.getTime())) {
      continue;
    }

    const key = keyFn(bucketDate);
    const bucketStartDate = bucketStartFn(bucketDate);
    const existing = aggregates.get(key);
    if (existing) {
      existing.pageViews += row.pageViews;
      existing.videoViews += row.videoViews;
      existing.uniqueVisitors += row.uniqueVisitors;
      existing.returnVisits += row.returnVisits;
      existing.magazineExternalLandings += row.magazineExternalLandings;
      existing.authEvents += row.authEvents;
      existing.sessions += (row.sessions ?? 0);
      continue;
    }

    const bucketEndDate = bucketEndFn(bucketStartDate);
    aggregates.set(key, {
      bucketStart: bucketStartDate.toISOString(),
      bucketEnd: bucketEndDate.toISOString(),
      label: labelFn(bucketStartDate, bucketEndDate),
      pageViews: row.pageViews,
      videoViews: row.videoViews,
      uniqueVisitors: row.uniqueVisitors,
      returnVisits: row.returnVisits,
      sessions: row.sessions ?? 0,
      magazineExternalLandings: row.magazineExternalLandings,
      authEvents: row.authEvents,
    });
  }

  return Array.from(aggregates.values()).sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));
}

function buildDailySeriesFromRows(rows: Array<{
  day?: string;
  pageViews?: number;
  videoViews?: number;
  uniqueVisitors?: number;
  returnVisits?: number;
  magazineExternalLandings?: number;
  authEvents?: number;
}>) {
  return rows
    .map((row, index) => {
      const dayString = typeof row.day === "string" ? row.day : "";
      const parsedDay = dayString ? parseIsoDay(dayString) : null;
      const bucketStartDate = parsedDay ?? addUtcDays(toUtcDayStart(new Date()), index);
      const bucketEndDate = addUtcDays(bucketStartDate, 1);

      return {
        bucketStart: bucketStartDate.toISOString(),
        bucketEnd: bucketEndDate.toISOString(),
        label: dayString || `Day ${index + 1}`,
        pageViews: Number(row.pageViews ?? 0),
        videoViews: Number(row.videoViews ?? 0),
        uniqueVisitors: Number(row.uniqueVisitors ?? 0),
        returnVisits: Number(row.returnVisits ?? 0),
        sessions: 0,
        magazineExternalLandings: Number(row.magazineExternalLandings ?? 0),
        authEvents: Number(row.authEvents ?? 0),
      } as AnalyticsSeriesBucket;
    })
    .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));
}

function toIsoString(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function buildHourlyRecentRows(
  analyticsRows: HourlyAnalyticsRow[],
  authRows: HourlyAuthRow[],
) {
  const authByBucketStart = new Map<string, number>();
  const analyticsByBucketStart = new Map<string, {
    pageViews: number;
    videoViews: number;
    uniqueVisitors: number;
    returnVisits: number;
    magazineExternalLandings: number;
  }>();
  const bucketStarts = new Set<string>();

  for (const row of authRows) {
    const bucketStartIso = toIsoString(row.bucketStart);
    if (!bucketStartIso) {
      continue;
    }

    authByBucketStart.set(bucketStartIso, toSafeNumber(row.authEvents));
    bucketStarts.add(bucketStartIso);
  }

  for (const row of analyticsRows) {
    const bucketStartIso = toIsoString(row.bucketStart);
    if (!bucketStartIso) {
      continue;
    }

    analyticsByBucketStart.set(bucketStartIso, {
      pageViews: toSafeNumber(row.pageViews),
      videoViews: toSafeNumber(row.videoViews),
      uniqueVisitors: toSafeNumber(row.uniqueVisitors),
      returnVisits: toSafeNumber(row.returnVisits),
      magazineExternalLandings: toSafeNumber(row.magazineExternalLandings),
    });
    bucketStarts.add(bucketStartIso);
  }

  const normalized = Array.from(bucketStarts)
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

  return normalized;
}

function normalizeDashboardPayload(rawPayload: unknown) {
  const base = createEmptyDashboardPayload();
  const raw = asObject(rawPayload);
  const rawHealth = asObject(raw.health);
  const rawHealthHost = asObject(rawHealth.host);
  const rawHealthMemory = asObject(rawHealth.memory);
  const rawAnalytics = asObject(raw.analytics);
  const rawAnalyticsSeries = asObject(rawAnalytics.series);
  const rawInsights = asObject(raw.insights);
  const rawGroqSpend = asObject(rawInsights.groqSpend);
  const rawMemoryDiagnostics = asObject(rawInsights.memoryDiagnostics);
  const rawMemoryProcess = asObject(rawMemoryDiagnostics.process);
  const rawMemoryCaches = asObject(rawMemoryDiagnostics.caches);

  const normalizedDaily = asArray<{
    day?: string;
    pageViews?: number;
    videoViews?: number;
    uniqueVisitors?: number;
    returnVisits?: number;
    magazineExternalLandings?: number;
    authEvents?: number;
  }>(rawAnalytics.daily);
  const normalizedHourlyRecent = asArray(rawAnalytics.hourlyRecent, asArray(rawAnalytics.hourly));
  const normalizedSeries = {
    ...base.analytics.series,
    ...rawAnalyticsSeries,
    allTime: asArray(rawAnalyticsSeries.allTime),
    monthly: asArray(rawAnalyticsSeries.monthly),
    weekly: asArray(rawAnalyticsSeries.weekly),
    daily: asArray(rawAnalyticsSeries.daily),
  };

  if (normalizedSeries.daily.length === 0 && normalizedDaily.length > 0) {
    normalizedSeries.daily = buildDailySeriesFromRows(normalizedDaily);
  }

  if (normalizedSeries.weekly.length === 0 && normalizedSeries.daily.length > 0) {
    normalizedSeries.weekly = aggregateSeriesBuckets(
      normalizedSeries.daily as AnalyticsSeriesBucket[],
      (date) => toWeekKey(date),
      (date) => startOfUtcWeek(date),
      (start) => addUtcDays(start, 7),
      (start, end) => `${toDayLabel(start)} to ${toDayLabel(addUtcDays(end, -1))}`,
    );
  }

  if (normalizedSeries.monthly.length === 0 && normalizedSeries.daily.length > 0) {
    normalizedSeries.monthly = aggregateSeriesBuckets(
      normalizedSeries.daily as AnalyticsSeriesBucket[],
      (date) => toMonthKey(date),
      (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
      (start) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)),
      (start) => `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }

  if (normalizedSeries.allTime.length === 0 && normalizedSeries.daily.length > 0) {
    normalizedSeries.allTime = aggregateSeriesBuckets(
      normalizedSeries.daily as AnalyticsSeriesBucket[],
      (date) => String(date.getUTCFullYear()),
      (date) => new Date(Date.UTC(date.getUTCFullYear(), 0, 1)),
      (start) => new Date(Date.UTC(start.getUTCFullYear() + 1, 0, 1)),
      (start) => String(start.getUTCFullYear()),
    );
  }

  return {
    ...base,
    ...raw,
    health: {
      ...base.health,
      ...rawHealth,
      memory: {
        ...base.health.memory,
        ...rawHealthMemory,
      },
      host: {
        ...base.health.host,
        ...rawHealthHost,
      },
    },
    locations: asArray(raw.locations),
    traffic: asArray(raw.traffic),
    analytics: {
      ...base.analytics,
      ...rawAnalytics,
      daily: normalizedDaily,
      hourlyRecent: normalizedHourlyRecent,
      series: normalizedSeries,
      engagement: {
        pagesPerSession: toSafeNumber((rawAnalytics.engagement as Record<string, unknown> | undefined)?.pagesPerSession),
        videosPerSession: toSafeNumber((rawAnalytics.engagement as Record<string, unknown> | undefined)?.videosPerSession),
      },
      registrationsPerDay: asArray(rawAnalytics.registrationsPerDay),
    },
    hostMetrics: {
      minute: asArray(asObject(raw.hostMetrics).minute),
    },
    insights: {
      ...base.insights,
      ...rawInsights,
      authActionBreakdown: asArray(rawInsights.authActionBreakdown),
      activeHours: asArray(rawInsights.activeHours),
      ingestVelocity: asArray(rawInsights.ingestVelocity),
      groqSpend: {
        ...base.insights.groqSpend,
        ...rawGroqSpend,
        daily: asArray(rawGroqSpend.daily),
      },
      memoryDiagnostics: {
        ...base.insights.memoryDiagnostics,
        ...rawMemoryDiagnostics,
        process: {
          ...base.insights.memoryDiagnostics.process,
          ...rawMemoryProcess,
        },
        caches: {
          ...base.insights.memoryDiagnostics.caches,
          ...rawMemoryCaches,
        },
      },
    },
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";

  if (!forceRefresh) {
    const cachedResult = getCachedDashboardResponsePayload();
    if (cachedResult) {
      return NextResponse.json(cachedResult);
    }

    const inFlight = getDashboardResponseInFlight();
    if (inFlight) {
      const result = await inFlight;
      return NextResponse.json(result);
    }
  }

  const loadResult = loadDashboardPayloadFromCacheTable();
  if (!forceRefresh) {
    // Store the payload-extraction promise so in-flight dedup returns a plain payload.
    setDashboardResponseInFlight(loadResult.then((r) => r.payload));
  }

  const { payload, usedFallback } = await loadResult.finally(() => {
    if (!forceRefresh) {
      setDashboardResponseInFlight(null);
    }
  });

  const ttlMs = usedFallback ? FALLBACK_TTL_MS : undefined;
  setCachedDashboardResponsePayload(payload, { ttlMs });

  return NextResponse.json(payload);
}