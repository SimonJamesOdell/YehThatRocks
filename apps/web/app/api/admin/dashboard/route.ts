import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiAuth } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";

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
      geoVisitors: [],
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
          analyticsGeo: {
            size: 0,
            maxEntries: 0,
            expiredEntries: 0,
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
  const normalizedSeries = {
    ...base.analytics.series,
    ...rawAnalyticsSeries,
    allTime: asArray(rawAnalyticsSeries.allTime),
    monthly: asArray(rawAnalyticsSeries.monthly),
    weekly: asArray(rawAnalyticsSeries.weekly),
    daily: asArray(rawAnalyticsSeries.daily),
  };

  if (normalizedSeries.daily.length === 0 && normalizedDaily.length > 0) {
    normalizedSeries.daily = normalizedDaily.map((row, index) => {
      const dayString = typeof row.day === "string" ? row.day : "";
      const start = dayString ? `${dayString}T00:00:00.000Z` : new Date(Date.now() + index * 86_400_000).toISOString();
      const endDate = new Date(start);
      endDate.setUTCDate(endDate.getUTCDate() + 1);

      return {
        bucketStart: start,
        bucketEnd: endDate.toISOString(),
        label: dayString || `Day ${index + 1}`,
        pageViews: Number(row.pageViews ?? 0),
        videoViews: Number(row.videoViews ?? 0),
        uniqueVisitors: Number(row.uniqueVisitors ?? 0),
        returnVisits: 0,
        magazineExternalLandings: 0,
        authEvents: 0,
      };
    });
  }

  if (normalizedSeries.weekly.length === 0 && normalizedSeries.daily.length > 0) {
    normalizedSeries.weekly = [...normalizedSeries.daily];
  }

  if (normalizedSeries.monthly.length === 0 && normalizedSeries.daily.length > 0) {
    normalizedSeries.monthly = [...normalizedSeries.daily];
  }

  if (normalizedSeries.allTime.length === 0 && normalizedSeries.daily.length > 0) {
    normalizedSeries.allTime = [...normalizedSeries.daily];
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
      hourlyRecent: asArray(rawAnalytics.hourlyRecent),
      series: normalizedSeries,
      registrationsPerDay: asArray(rawAnalytics.registrationsPerDay),
      geoVisitors: asArray(rawAnalytics.geoVisitors),
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

  // Read from pre-computed cache table — no side effects, super fast
  const cacheRows = await prisma.$queryRaw<Array<{ payload: string; computed_at: Date }>>`
    SELECT payload, computed_at FROM admin_dashboard_cache WHERE id = 1
  `.catch(() => []);

  if (cacheRows.length === 0) {
    return NextResponse.json(createEmptyDashboardPayload());
  }

  const cacheRow = cacheRows[0];
  const payload = normalizeDashboardPayload(JSON.parse(cacheRow.payload));

  return NextResponse.json(payload);
}
