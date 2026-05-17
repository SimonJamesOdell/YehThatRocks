import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiAuth } from "@/lib/admin-auth";
import { getMetadataQualityStats } from "@/lib/admin-metadata-quality";
import {
  getCachedDashboardResponsePayload,
  getDashboardResponseInFlight,
  setCachedDashboardResponsePayload,
  setDashboardResponseInFlight,
} from "@/lib/admin-dashboard-response-cache";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadDashboardPayloadFromCacheTable(): Promise<Record<string, unknown>> {
  // Read from pre-computed cache table — no side effects, super fast
  const cacheRows = await prisma.$queryRaw<Array<{ payload: string; computed_at: Date }>>`
    SELECT payload, computed_at FROM admin_dashboard_cache WHERE id = 1
  `.catch(() => []);

  if (cacheRows.length === 0) {
    return createEmptyDashboardPayload();
  }

  const cacheRow = cacheRows[0];
  const payload = normalizeDashboardPayload(JSON.parse(cacheRow.payload));
  payload.insights.metadataQuality = await getMetadataQualityStats();

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
  }

  return payload as Record<string, unknown>;
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
      groqSpend: {
        wikiCacheCount: 0,
        daily: [],
      },
      apiUsage: {
        daily: [],
        totals7d: {
          youtubeCalls: 0,
          youtubeUnits: 0,
          youtubeErrors: 0,
          groqCalls: 0,
          groqUnits: 0,
          groqErrors: 0,
          groqClassified: 0,
          youtubeSuccessRate: 100,
          groqSuccessRate: 100,
        },
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
      magazineExternalLandings: row.magazineExternalLandings,
      authEvents: row.authEvents,
    });
  }

  return Array.from(aggregates.values()).sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));
}

function buildDailySeriesFromRows(rows: Array<{ day?: string; pageViews?: number; videoViews?: number; uniqueVisitors?: number }>) {
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
        returnVisits: 0,
        magazineExternalLandings: 0,
        authEvents: 0,
      } as AnalyticsSeriesBucket;
    })
    .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));
}

function toIsoString(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function toSafeNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
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
  const rawApiUsage = asObject(rawInsights.apiUsage);
  const rawTotals7d = asObject(rawApiUsage.totals7d);
  const rawMemoryDiagnostics = asObject(rawInsights.memoryDiagnostics);
  const rawMemoryProcess = asObject(rawMemoryDiagnostics.process);
  const rawMemoryCaches = asObject(rawMemoryDiagnostics.caches);

  const normalizedDaily = asArray<{ day?: string; pageViews?: number; videoViews?: number; uniqueVisitors?: number }>(rawAnalytics.daily);
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
      registrationsPerDay: asArray(rawAnalytics.registrationsPerDay),
    },
    hostMetrics: {
      minute: asArray(asObject(raw.hostMetrics).minute),
    },
    insights: {
      ...base.insights,
      ...rawInsights,
      authActionBreakdown: asArray(rawInsights.authActionBreakdown),
      ingestVelocity: asArray(rawInsights.ingestVelocity),
      groqSpend: {
        ...base.insights.groqSpend,
        ...rawGroqSpend,
        daily: asArray(rawGroqSpend.daily),
      },
      apiUsage: {
        ...base.insights.apiUsage,
        ...rawApiUsage,
        daily: asArray(rawApiUsage.daily),
        totals7d: {
          ...base.insights.apiUsage.totals7d,
          ...rawTotals7d,
        },
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
    const cachedPayload = getCachedDashboardResponsePayload();
    if (cachedPayload) {
      return NextResponse.json(cachedPayload);
    }

    const inFlight = getDashboardResponseInFlight();
    if (inFlight) {
      const payload = await inFlight;
      return NextResponse.json(payload);
    }
  }

  const loadPayload = loadDashboardPayloadFromCacheTable();
  if (!forceRefresh) {
    setDashboardResponseInFlight(loadPayload);
  }

  const payload = await loadPayload.finally(() => {
    if (!forceRefresh) {
      setDashboardResponseInFlight(null);
    }
  });

  setCachedDashboardResponsePayload(payload);

  return NextResponse.json(payload);
}
