"use client";

import Link from "next/link";
import { geoContains, geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import worldAtlasCountries from "world-atlas/countries-110m.json";

import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";
import { useAdminHealthStreaming } from "@/components/use-admin-health-streaming";
import { useAdminVideoQueuePolling } from "@/components/use-admin-video-queue-polling";
import { useAdminAnalyticsRefresh } from "@/components/use-admin-analytics-refresh";
import { useAdminApiTabPolling } from "@/components/use-admin-api-tab-polling";

const HEALTH_FALLBACK_POLL_MS = 2_000;
const ANALYTICS_AUTO_REFRESH_MS = 5 * 60 * 1000;

function finiteOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type AnalyticsBucket = {
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

type AnalyticsZoomLevel = "allTime" | "monthly" | "weekly" | "daily" | "hourly";

type GeoVisitorPoint = {
  visitorId: string;
  lat: number;
  lng: number;
  eventCount: number;
  lastSeenAt: string;
};

type MapDateRange = "allTime" | "today" | "thisWeek" | "thisMonth" | "thisYear";

type WorldAtlasCountryFeature = {
  id: string | number;
  properties?: { name?: string };
  geometry: unknown;
};

type DashboardPayload = {
  meta: { durationMs: number; generatedAt: string };
  health: {
    nodeUptimeSec: number;
    memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
    host: {
      platform: string;
      loadAvg: number[];
      totalMemMb: number;
      freeMemMb: number;
      cpuUsagePercent: number | null;
      cpuAverageUsagePercent: number | null;
      cpuPeakCoreUsagePercent: number | null;
      memoryUsagePercent: number;
      diskUsagePercent: number | null;
      swapUsagePercent: number | null;
      networkUsagePercent: number | null;
    };
  };
  counts: {
    users: number;
    registeredUsers: number;
    anonymousUsers: number;
    videos: number;
    artists: number;
    categories: number;
  };
  locations: Array<{ location: string; count: number }>;
  traffic: Array<{ day: string; count: number }>;
  analytics: {
    daily: Array<{ day: string; pageViews: number; videoViews: number; uniqueVisitors: number }>;
    hourlyRecent: Array<{
      bucketStart: string;
      pageViews: number;
      videoViews: number;
      uniqueVisitors: number;
      returnVisits: number;
      magazineExternalLandings: number;
      authEvents: number;
    }>;
    series: {
      allTime: AnalyticsBucket[];
      monthly: AnalyticsBucket[];
      weekly: AnalyticsBucket[];
      daily: AnalyticsBucket[];
    };
    newVsRepeat: { newVisitors: number; repeatVisitors: number };
    registrationsPerDay: Array<{ day: string; count: number }>;
    totals: { pageViews: number; videoViews: number; uniqueVisitors: number; sessions: number };
    geoVisitors: GeoVisitorPoint[];
  };
  hostMetrics: {
    minute: Array<{
      bucketStart: string;
      cpuUsagePercent: number | null;
      memoryUsagePercent: number | null;
      swapUsagePercent: number | null;
      diskUsagePercent: number | null;
      networkUsagePercent: number | null;
    }>;
  };
  insights: {
    auth24h: {
      total: number;
      success: number;
      failed: number;
      uniqueIps: number;
      uniqueUsers: number;
    };
    authActionBreakdown: Array<{ action: string; total: number; failed: number }>;
    metadataQuality: {
      availableVideos: number;
      checkFailedEntries: number;
      missingMetadata: number;
      lowConfidence: number;
      unknownType: number;
    };
    ingestVelocity: Array<{ day: string; count: number }>;
    groqSpend: {
      wikiCacheCount: number;
      daily: Array<{ day: string; classified: number; errors: number }>;
    };
    apiUsage: {
      daily: Array<{
        day: string;
        youtubeCalls: number;
        youtubeUnits: number;
        youtubeErrors: number;
        groqCalls: number;
        groqUnits: number;
        groqErrors: number;
        groqClassified: number;
      }>;
      totals7d: {
        youtubeCalls: number;
        youtubeUnits: number;
        youtubeErrors: number;
        groqCalls: number;
        groqUnits: number;
        groqErrors: number;
        groqClassified: number;
        youtubeSuccessRate: number;
        groqSuccessRate: number;
      };
    };
    memoryDiagnostics: {
      snapshotAt: string;
      process: {
        rssMb: number;
        heapUsedMb: number;
        heapTotalMb: number;
        externalMb: number;
        arrayBuffersMb: number;
      };
      caches: {
        currentVideo: {
          currentVideoCache: number;
          currentVideoPendingCache: number;
          currentVideoInflight: number;
          currentVideoRelatedPoolCache: number;
          currentVideoRelatedPoolInflight: number;
        };
        artist: {
          limits: { defaultMaxEntries: number; heavyMaxEntries: number };
          sizes: {
            artistNormVideoPoolCache: number;
            artistNormVideoPoolInFlight: number;
            sameGenreRelatedPoolCache: number;
            sameGenreRelatedPoolInFlight: number;
            artistLetterCache: number;
            artistLetterPageCache: number;
            artistSearchCache: number;
            artistSingleSlugCache: number;
            artistVideosCache: number;
            artistVideosInFlight: number;
          };
        };
        analyticsGeo: {
          size: number;
          maxEntries: number;
          expiredEntries: number;
        };
        wikiCacheCount: number;
      };
    };
  };
};

type AdminHealthStreamPayload = {
  health: DashboardPayload["health"];
  meta: { generatedAt: string };
};

type CategoryRow = { id: number; genre: string; thumbnailVideoId: string | null; updatedAt: string };
type VideoRow = {
  id: number;
  videoId: string;
  title: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
  parsedVideoType: string | null;
  parseConfidence: number | null;
  channelTitle: string | null;
  updatedAt: string | null;
};
type RecentlyApprovedVideoRow = {
  id: number;
  videoId: string;
  title: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
  channelTitle: string | null;
  updatedAt: string | null;
};
type PendingVideoRow = {
  id: number;
  videoId: string;
  title: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
  channelTitle: string | null;
  durationSec: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};
type PendingVideoDraft = {
  title: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
};
type CatalogReviewVideoRow = {
  id: number;
  videoId: string;
  title: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
  channelTitle: string | null;
  durationSec: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  enqueuedAt: string | null;
};

type PerfWindowResetResponse = {
  ok: boolean;
  startedAt: string;
  deletedSamples: number;
  sampleIntervalSeconds: number;
  slowLog: {
    enabled: boolean;
    warning: string | null;
  };
};

type AdminMagazineArticleRow = {
  slug: string;
  title: string;
  videoId: string | null;
  publishedAt: string;
  externalLandings: number;
};

export type AdminTab = "overview" | "magazine" | "performance" | "worldmap" | "api" | "categories" | "videos" | "catalog-review";

async function readJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetchWithAuthRetry(input, init);

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

async function readNoStoreJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  return readJson<T>(input, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.headers ?? {}),
      "Cache-Control": "no-store",
    },
  });
}

function isAuthResponseError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === "Unauthorized" ||
    error.message === "Forbidden" ||
    error.message.includes("(401)") ||
    error.message.includes("(403)")
  );
}

function Dial({ label, value, color, detail }: { label: string; value: number | null; color: string; detail?: string | null }) {
  const radius = 34;
  const stroke = 8;
  const size = 90;
  const circumference = 2 * Math.PI * radius;
  const safeValue = value === null ? 0 : Math.max(0, Math.min(100, value));
  const offset = circumference * (1 - safeValue / 100);
  const dialWidthPx = 132;

  return (
    <div style={{ display: "grid", justifyItems: "center", gap: 6, width: dialWidthPx, minWidth: dialWidthPx }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label} ${value === null ? "n/a" : `${Math.round(safeValue)} percent`}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.14)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" fill="#fff" style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {value === null ? "n/a" : `${Math.round(safeValue)}%`}
        </text>
      </svg>
      <span className="authMessage" style={{ margin: 0 }}>{label}</span>
      {detail ? (
        <span className="authMessage" style={{ margin: 0, width: "100%", textAlign: "center", whiteSpace: "pre-line", fontVariantNumeric: "tabular-nums" }}>
          {detail}
        </span>
      ) : null}
    </div>
  );
}

export function AdminDashboardPanel({ activeTab }: { activeTab: AdminTab }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [pendingVideos, setPendingVideos] = useState<PendingVideoRow[]>([]);
  const [pendingVideoDrafts, setPendingVideoDrafts] = useState<Record<number, PendingVideoDraft>>({});
  const [pendingPreviewSkipOffsets, setPendingPreviewSkipOffsets] = useState<Record<number, number>>({});
  const pendingPreviewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const pendingPreviewCurrentTimeRef = useRef<number | null>(null);
  const catalogReviewPreviewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const catalogReviewPreviewCurrentTimeRef = useRef<number | null>(null);
  const [pendingVideoTotal, setPendingVideoTotal] = useState(0);
  const [catalogReviewRemaining, setCatalogReviewRemaining] = useState(0);
  const [catalogReviewCurrentVideo, setCatalogReviewCurrentVideo] = useState<CatalogReviewVideoRow | null>(null);
  const [catalogReviewActionVideoId, setCatalogReviewActionVideoId] = useState<string | null>(null);
  const [recentlyApprovedVideos, setRecentlyApprovedVideos] = useState<RecentlyApprovedVideoRow[]>([]);
  const [videoModerationPane, setVideoModerationPane] = useState<"pending" | "recent">("pending");
  const [revokingVideoId, setRevokingVideoId] = useState<string | null>(null);
  const [magazineArticles, setMagazineArticles] = useState<AdminMagazineArticleRow[]>([]);
  const [deleteModalSlug, setDeleteModalSlug] = useState<string | null>(null);

  const [videoQuery, setVideoQuery] = useState("");
  const [videoImportSource, setVideoImportSource] = useState("");
  const [ingestingVideo, setIngestingVideo] = useState(false);
  const [moderatingVideoId, setModeratingVideoId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [refreshingAnalytics, setRefreshingAnalytics] = useState(false);
  const [resettingPerfWindow, setResettingPerfWindow] = useState(false);
  const [analyticsZoomLevel, setAnalyticsZoomLevel] = useState<AnalyticsZoomLevel>("daily");
  const [selectedAllTimeBucket, setSelectedAllTimeBucket] = useState<AnalyticsBucket | null>(null);
  const [selectedMonthlyBucket, setSelectedMonthlyBucket] = useState<AnalyticsBucket | null>(null);
  const [selectedWeeklyBucket, setSelectedWeeklyBucket] = useState<AnalyticsBucket | null>(null);
  const [showHostMetricsGraph, setShowHostMetricsGraph] = useState(false);
  const [mapDateRange, setMapDateRange] = useState<MapDateRange>("allTime");

  type QuotaBackfillStatus = {
    todayUsageUnits: number;
    remainingUnits: number;
    recommendedBudget: number;
    availableSeedCount: number;
    quotaResetAt: string;
    msUntilReset: number;
  };
  const [quotaStatus, setQuotaStatus] = useState<QuotaBackfillStatus | null>(null);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const [msUntilReset, setMsUntilReset] = useState<number | null>(null);
  const [hostMetricSeriesOn, setHostMetricSeriesOn] = useState({
    cpu: true,
    memory: true,
    swap: true,
    disk: true,
    network: true,
  });
  const cpuAvgPeakText =
    finiteOrNull(dashboard?.health.host.cpuAverageUsagePercent) === null ||
    finiteOrNull(dashboard?.health.host.cpuPeakCoreUsagePercent) === null
      ? "Avg : n/a\nPeak : n/a"
      : `Avg : ${Math.round(finiteOrNull(dashboard?.health.host.cpuAverageUsagePercent) ?? 0)}%\nPeak : ${Math.round(finiteOrNull(dashboard?.health.host.cpuPeakCoreUsagePercent) ?? 0)}%`;

  const hostMetricRows = useMemo(() => (dashboard?.hostMetrics.minute ?? []).slice(), [dashboard]);
  const orderedIngestVelocity = useMemo(() => (dashboard?.insights.ingestVelocity ?? []).slice().reverse(), [dashboard]);
  const orderedGroqSpend = useMemo(() => (dashboard?.insights.groqSpend.daily ?? []).slice().reverse(), [dashboard]);
  const maxIngestCount = useMemo(() => Math.max(1, ...orderedIngestVelocity.map((item) => item.count)), [orderedIngestVelocity]);
  const maxGroqCount = useMemo(() => Math.max(1, ...orderedGroqSpend.map((item) => item.classified + item.errors)), [orderedGroqSpend]);
  const worldMapVisitors = useMemo(() => (dashboard?.analytics.geoVisitors ?? []).slice(), [dashboard]);
  const apiUsageRows = useMemo(() => (dashboard?.insights.apiUsage.daily ?? []).slice(), [dashboard]);
  const apiUsageTotals7d = dashboard?.insights.apiUsage.totals7d;
  const filteredWorldMapVisitors = useMemo(() => {
    if (mapDateRange === "allTime") {
      return worldMapVisitors;
    }

    const now = new Date();
    const since = new Date(now);
    if (mapDateRange === "today") {
      since.setHours(0, 0, 0, 0);
    } else if (mapDateRange === "thisWeek") {
      const day = since.getDay();
      const daysSinceMonday = (day + 6) % 7;
      since.setDate(since.getDate() - daysSinceMonday);
      since.setHours(0, 0, 0, 0);
    } else if (mapDateRange === "thisMonth") {
      since.setDate(1);
      since.setHours(0, 0, 0, 0);
    } else {
      since.setMonth(0, 1);
      since.setHours(0, 0, 0, 0);
    }

    return worldMapVisitors.filter((visitor) => {
      const seenAt = new Date(visitor.lastSeenAt);
      return Number.isFinite(seenAt.getTime()) && seenAt >= since;
    });
  }, [mapDateRange, worldMapVisitors]);
  const worldCountryFeatures = useMemo(() => {
    try {
      const topo = worldAtlasCountries as {
        objects?: { countries?: unknown };
      };
      if (!topo.objects?.countries) {
        return [] as WorldAtlasCountryFeature[];
      }

      const collection = feature(topo as never, topo.objects.countries as never) as {
        features?: WorldAtlasCountryFeature[];
      };
      return collection.features ?? [];
    } catch {
      return [] as WorldAtlasCountryFeature[];
    }
  }, []);
  const worldMap = useMemo(() => {
    const width = 880;
    const height = 340;
    const projection = geoNaturalEarth1().fitExtent(
      [[10, 10], [width - 10, height - 10]],
      { type: "Sphere" } as never,
    );
    const pathGenerator = geoPath(projection);

    const countries = worldCountryFeatures
      .map((country, index) => {
        const path = pathGenerator(country as never);
        if (!path) {
          return null;
        }

        const normalizedId = String(country.id ?? "unknown");
        const countryName = String(country.properties?.name ?? country.id ?? "Unknown");
        const renderKey = `${normalizedId}-${countryName}-${index}`;

        return {
          id: normalizedId,
          name: countryName,
          renderKey,
          geometry: country,
          path,
        };
      })
      .filter((country): country is { id: string; name: string; renderKey: string; geometry: WorldAtlasCountryFeature; path: string } => Boolean(country));

    const countryVisitorCount = new Map<string, number>();
    for (const point of filteredWorldMapVisitors) {
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
        continue;
      }

      const containingCountry = countries.find((country) => geoContains(country.geometry as never, [point.lng, point.lat]));
      if (!containingCountry) {
        continue;
      }

      countryVisitorCount.set(
        containingCountry.id,
        (countryVisitorCount.get(containingCountry.id) ?? 0) + 1,
      );
    }

    const maxCountryVisitors = Math.max(1, ...Array.from(countryVisitorCount.values()));

    const getCountryFill = (countryId: string) => {
      const visitorCount = countryVisitorCount.get(countryId) ?? 0;
      const ratio = visitorCount <= 0 ? 0 : visitorCount / maxCountryVisitors;
      const red = Math.round(255 * ratio);
      return `rgb(${red},0,0)`;
    };

    const meridians = Array.from({ length: 11 }, (_, index) => (index * width) / 10);
    const parallels = Array.from({ length: 7 }, (_, index) => (index * height) / 6);

    return {
      width,
      height,
      meridians,
      parallels,
      countries,
      countryVisitorCount,
      getCountryFill,
      maxCountryVisitors,
    };
  }, [filteredWorldMapVisitors, worldCountryFeatures]);
  const filterBucketsWithinRange = (rows: AnalyticsBucket[], range: AnalyticsBucket | null) => {
    if (!range) {
      return rows;
    }

    const filtered = rows.filter((row) => row.bucketStart >= range.bucketStart && row.bucketEnd <= range.bucketEnd);
    return filtered.length > 0 ? filtered : rows;
  };

  const analyticsSeries = dashboard?.analytics.series;
  const apiUsageGraph = useMemo(() => {
    const width = 760;
    const height = 240;
    const paddingLeft = 52;
    const paddingRight = 24;
    const paddingTop = 14;
    const paddingBottom = 46;
    const rows = apiUsageRows.slice(-14);

    if (rows.length === 0) {
      return {
        width,
        height,
        bars: [] as Array<{ x: number; youtubeHeight: number; groqHeight: number; groqClassifiedHeight: number; label: string; youtubeUnits: number; groqCalls: number; groqClassified: number }> ,
        yTicks: [] as Array<{ y: number; value: number }>,
        axis: { paddingLeft, paddingRight, paddingTop, paddingBottom },
        barWidth: 8,
        chartHeight: height - paddingTop - paddingBottom,
      };
    }

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;
    const maxValue = Math.max(1, ...rows.map((row) => Math.max(row.youtubeUnits, row.groqCalls, row.groqClassified)));
    const groupWidth = chartWidth / rows.length;
    const barWidth = Math.max(6, Math.min(18, (groupWidth - 8) / 3));
    const scaleHeight = (value: number) => (value / maxValue) * chartHeight;

    const bars = rows.map((row, index) => {
      const x = paddingLeft + index * groupWidth + (groupWidth - (barWidth * 3 + 4)) / 2;
      return {
        x,
        youtubeHeight: scaleHeight(row.youtubeUnits),
        groqHeight: scaleHeight(row.groqCalls),
        groqClassifiedHeight: scaleHeight(row.groqClassified),
        label: row.day.slice(5),
        youtubeUnits: row.youtubeUnits,
        groqCalls: row.groqCalls,
        groqClassified: row.groqClassified,
      };
    });

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
      y: paddingTop + chartHeight - ratio * chartHeight,
      value: Math.round(maxValue * ratio),
    }));

    return {
      width,
      height,
      bars,
      yTicks,
      axis: { paddingLeft, paddingRight, paddingTop, paddingBottom },
      barWidth,
      chartHeight,
    };
  }, [apiUsageRows]);
  const hourlySeries = useMemo(() => {
    const recent = (dashboard?.analytics.hourlyRecent ?? []).slice(-24);

    return recent.map((row) => {
      const bucketStartDate = new Date(row.bucketStart);
      const bucketEndDate = new Date(bucketStartDate.getTime() + 60 * 60 * 1000);

      return {
        bucketStart: row.bucketStart,
        bucketEnd: bucketEndDate.toISOString(),
        label: bucketStartDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        pageViews: row.pageViews,
        videoViews: row.videoViews,
        uniqueVisitors: row.uniqueVisitors,
        returnVisits: row.returnVisits,
        magazineExternalLandings: 0,
        authEvents: row.authEvents,
      } as AnalyticsBucket;
    });
  }, [dashboard]);

  const displayedAnalyticsRows = useMemo(() => {
    if (!analyticsSeries) {
      return [] as AnalyticsBucket[];
    }

    if (analyticsZoomLevel === "allTime") {
      return analyticsSeries.allTime;
    }

    if (analyticsZoomLevel === "monthly") {
      return filterBucketsWithinRange(analyticsSeries.monthly, selectedAllTimeBucket);
    }

    if (analyticsZoomLevel === "weekly") {
      return filterBucketsWithinRange(analyticsSeries.weekly, selectedMonthlyBucket);
    }

    if (analyticsZoomLevel === "hourly") {
      return hourlySeries;
    }

    return filterBucketsWithinRange(analyticsSeries.daily, selectedWeeklyBucket);
  }, [analyticsSeries, analyticsZoomLevel, selectedAllTimeBucket, selectedMonthlyBucket, selectedWeeklyBucket, hourlySeries]);

  const [analyticsSeriesOn, setAnalyticsSeriesOn] = useState({ pageViews: true, videoViews: true, visitors: true, returnVisits: true, magazineExternalLandings: true, authEvents: true });
  const analyticsGraph = useMemo(() => {
    const width = 680;
    const height = 220;
    const paddingLeft = 46;
    const paddingRight = 20;
    const paddingTop = 14;
    const paddingBottom = 46;

    if (displayedAnalyticsRows.length === 0) {
      return {
        width,
        height,
        pageViewsPath: "",
        videoViewsPath: "",
        visitorsPath: "",
        returnVisitsPath: "",
        magazineExternalLandingsPath: "",
        authEventsPath: "",
        yTicks: [],
        xTicks: [],
        points: [],
        axis: { paddingLeft, paddingRight, paddingTop, paddingBottom },
      };
    }

    const enabledSeriesMaxPerDay = (row: { pageViews: number; videoViews: number; uniqueVisitors: number; returnVisits: number; magazineExternalLandings: number; authEvents: number }) => Math.max(
      analyticsSeriesOn.pageViews ? row.pageViews : 0,
      analyticsSeriesOn.videoViews ? row.videoViews : 0,
      analyticsSeriesOn.visitors ? row.uniqueVisitors : 0,
      analyticsSeriesOn.returnVisits ? row.returnVisits : 0,
      analyticsSeriesOn.magazineExternalLandings ? row.magazineExternalLandings : 0,
      analyticsSeriesOn.authEvents ? row.authEvents : 0,
    );

    const maxVal = Math.max(
      1,
      ...displayedAnalyticsRows.map((d) => enabledSeriesMaxPerDay(d)),
    );
    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;
    const step = displayedAnalyticsRows.length > 1 ? chartWidth / (displayedAnalyticsRows.length - 1) : 0;

    const points = displayedAnalyticsRows.map((item, index) => {
      const x = paddingLeft + index * step;
      return {
        x,
        yPageViews: paddingTop + chartHeight - (item.pageViews / maxVal) * chartHeight,
        yVideoViews: paddingTop + chartHeight - (item.videoViews / maxVal) * chartHeight,
        yVisitors: paddingTop + chartHeight - (item.uniqueVisitors / maxVal) * chartHeight,
        yReturnVisits: paddingTop + chartHeight - (item.returnVisits / maxVal) * chartHeight,
        yMagazineExternalLandings: paddingTop + chartHeight - (item.magazineExternalLandings / maxVal) * chartHeight,
        yAuthEvents: paddingTop + chartHeight - (item.authEvents / maxVal) * chartHeight,
        bucketStart: item.bucketStart,
        bucketEnd: item.bucketEnd,
        label: item.label,
        pageViews: item.pageViews,
        videoViews: item.videoViews,
        uniqueVisitors: item.uniqueVisitors,
        returnVisits: item.returnVisits,
        magazineExternalLandings: item.magazineExternalLandings,
        authEvents: item.authEvents,
      };
    });

    const makePath = (ys: number[]) =>
      ys.map((y, i) => `${i === 0 ? "M" : "L"} ${(paddingLeft + i * step).toFixed(2)} ${y.toFixed(2)}`).join(" ");

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
      y: paddingTop + chartHeight - ratio * chartHeight,
      value: Math.round(maxVal * ratio),
    }));

    const tickCount = Math.min(6, points.length);
    const xTicks = Array.from({ length: tickCount }, (_, index) => {
      const pointIndex = tickCount === 1 ? 0 : Math.round((index / (tickCount - 1)) * (points.length - 1));
      const point = points[pointIndex];

      return {
        x: point.x,
        label: point.label,
      };
    });

    return {
      width,
      height,
      yTicks,
      xTicks,
      points,
      axis: { paddingLeft, paddingRight, paddingTop, paddingBottom },
      pageViewsPath: makePath(points.map((p) => p.yPageViews)),
      videoViewsPath: makePath(points.map((p) => p.yVideoViews)),
      visitorsPath: makePath(points.map((p) => p.yVisitors)),
      returnVisitsPath: makePath(points.map((p) => p.yReturnVisits)),
      magazineExternalLandingsPath: makePath(points.map((p) => p.yMagazineExternalLandings)),
      authEventsPath: makePath(points.map((p) => p.yAuthEvents)),
    };
  }, [analyticsSeriesOn, displayedAnalyticsRows]);

  const hostMetricsGraph = useMemo(() => {
    const width = 680;
    const height = 220;
    const paddingLeft = 46;
    const paddingRight = 20;
    const paddingTop = 14;
    const paddingBottom = 28;

    if (hostMetricRows.length === 0) {
      return {
        width,
        height,
        axis: { paddingLeft, paddingRight, paddingTop, paddingBottom },
        cpuPath: "",
        memoryPath: "",
        swapPath: "",
        diskPath: "",
        networkPath: "",
        xTicks: [] as Array<{ x: number; label: string }>,
        yTicks: [] as Array<{ y: number; value: number }>,
      };
    }

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;
    const percentToY = (value: number) => paddingTop + chartHeight - (Math.max(0, Math.min(100, value)) / 100) * chartHeight;
    const xForIndex = (index: number) => {
      if (hostMetricRows.length === 1) {
        return paddingLeft + chartWidth / 2;
      }

      return paddingLeft + (index / (hostMetricRows.length - 1)) * chartWidth;
    };

    const points = hostMetricRows.map((row, index) => ({
      x: xForIndex(index),
      cpu: finiteOrNull(row.cpuUsagePercent),
      memory: finiteOrNull(row.memoryUsagePercent),
      swap: finiteOrNull(row.swapUsagePercent),
      disk: finiteOrNull(row.diskUsagePercent),
      network: finiteOrNull(row.networkUsagePercent),
      bucketStart: row.bucketStart,
    }));

    const makePath = (values: Array<number | null>) => {
      let path = "";

      values.forEach((value, index) => {
        if (value === null) {
          return;
        }

        const command = path === "" || values[index - 1] === null ? "M" : "L";
        path += `${command}${points[index].x.toFixed(1)},${percentToY(value).toFixed(1)}`;
      });

      return path;
    };

    const tickCount = Math.min(6, hostMetricRows.length);
    const xTicks = Array.from({ length: tickCount }, (_, tickIndex) => {
      const rowIndex = tickCount === 1
        ? 0
        : Math.round((tickIndex / (tickCount - 1)) * (hostMetricRows.length - 1));
      const row = hostMetricRows[rowIndex];
      const date = new Date(row.bucketStart);
      const label = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      return {
        x: xForIndex(rowIndex),
        label,
      };
    });

    const yTicks = [0, 25, 50, 75, 100].map((value) => ({
      value,
      y: percentToY(value),
    }));

    return {
      width,
      height,
      axis: { paddingLeft, paddingRight, paddingTop, paddingBottom },
      cpuPath: makePath(points.map((point) => point.cpu)),
      memoryPath: makePath(points.map((point) => point.memory)),
      swapPath: makePath(points.map((point) => point.swap)),
      diskPath: makePath(points.map((point) => point.disk)),
      networkPath: makePath(points.map((point) => point.network)),
      xTicks,
      yTicks,
    };
  }, [hostMetricRows]);

  const loadOverview = useCallback(async (forceRefresh = false) => {
    const query = forceRefresh ? `?refresh=1&t=${Date.now()}` : "";
    const url = `/api/admin/dashboard${query}`;
    const dashboardPayload = forceRefresh
      ? await readNoStoreJson<DashboardPayload>(url)
      : await readJson<DashboardPayload>(url);
    setDashboard(dashboardPayload);
  }, []);

  const refreshOverviewAnalytics = useCallback(async () => {
    setRefreshingAnalytics(true);

    try {
      await loadOverview(true);
    } finally {
      setRefreshingAnalytics(false);
    }
  }, [loadOverview]);

  async function loadCategories() {
    const categoryPayload = await readJson<{ categories: CategoryRow[] }>("/api/admin/categories");
    setCategories(categoryPayload.categories);
  }

  async function loadVideos() {
    const videoPayload = await readJson<{ videos: VideoRow[] }>(
      `/api/admin/videos${videoQuery ? `?q=${encodeURIComponent(videoQuery)}` : ""}`,
    );
    setVideos(videoPayload.videos);
  }

  async function loadPendingVideos() {
    const pendingPayload = await readJson<{ pendingVideos: PendingVideoRow[]; totalPending?: number }>(
      "/api/admin/videos/pending",
    );
    setPendingVideos(pendingPayload.pendingVideos);
    setPendingVideoTotal(Number(pendingPayload.totalPending ?? pendingPayload.pendingVideos.length));
    setPendingVideoDrafts((current) => {
      const liveIds = new Set(pendingPayload.pendingVideos.map((item) => item.id));
      const next: Record<number, PendingVideoDraft> = {};

      for (const [key, draft] of Object.entries(current)) {
        const id = Number(key);
        if (liveIds.has(id)) {
          next[id] = draft;
        }
      }

      return next;
    });
    setPendingPreviewSkipOffsets((current) => {
      const liveIds = new Set(pendingPayload.pendingVideos.map((item) => item.id));
      const next: Record<number, number> = {};

      for (const [key, offset] of Object.entries(current)) {
        const id = Number(key);
        if (liveIds.has(id)) {
          next[id] = offset;
        }
      }

      return next;
    });
  }

  async function loadRecentlyApprovedVideos() {
    try {
      const payload = await readJson<{ recentlyApproved: RecentlyApprovedVideoRow[] }>(
        "/api/admin/videos/recently-approved",
      );
      setRecentlyApprovedVideos(payload.recentlyApproved);
    } catch {
      // Non-fatal — keep last known list.
    }
  }

  async function loadCatalogReviewQueue() {
    const payload = await readJson<{
      remaining: number;
      currentVideo: CatalogReviewVideoRow | null;
    }>("/api/admin/videos/catalog-review");

    setCatalogReviewRemaining(Number(payload.remaining ?? 0));
    setCatalogReviewCurrentVideo(payload.currentVideo ?? null);
  }

  async function moderateCatalogReviewVideo(action: "approve" | "remove") {
    if (!catalogReviewCurrentVideo) {
      return;
    }

    setCatalogReviewActionVideoId(catalogReviewCurrentVideo.videoId);

    try {
      await postJson<{ ok: boolean; remaining?: number }>("/api/admin/videos/catalog-review", {
        videoId: catalogReviewCurrentVideo.videoId,
        action,
      });

      setSaveMessage(action === "approve"
        ? `Kept ${catalogReviewCurrentVideo.videoId}.`
        : `Removed ${catalogReviewCurrentVideo.videoId}.`);

      await Promise.all([
        loadCatalogReviewQueue(),
        action === "remove" ? loadVideos() : Promise.resolve(),
      ]);
    } catch (moderationError) {
      setSaveMessage(moderationError instanceof Error ? moderationError.message : "Catalog review action failed.");
    } finally {
      setCatalogReviewActionVideoId(null);
    }
  }

  async function refreshCatalogReviewMetadata() {
    if (!catalogReviewCurrentVideo) {
      return;
    }

    setCatalogReviewActionVideoId(catalogReviewCurrentVideo.videoId);

    try {
      await postJson<{ ok: boolean; video?: { id: number; videoId: string } }>('/api/admin/videos/refetch-data', {
        id: catalogReviewCurrentVideo.id,
        videoId: catalogReviewCurrentVideo.videoId,
      });

      setSaveMessage(`Refreshed metadata for ${catalogReviewCurrentVideo.videoId} from YouTube.`);
      await loadCatalogReviewQueue();
    } catch (refreshError) {
      setSaveMessage(refreshError instanceof Error ? refreshError.message : "Metadata refresh failed.");
    } finally {
      setCatalogReviewActionVideoId(null);
    }
  }

  async function revokeApprovedVideo(videoId: string) {
    setRevokingVideoId(videoId);
    try {
      await postJson<{ ok: boolean }>("/api/admin/videos/recently-approved", { videoId });
      setSaveMessage(`Revoked approval for ${videoId} — returned to pending queue.`);
      await Promise.all([loadRecentlyApprovedVideos(), loadPendingVideos()]);
    } catch (revokeError) {
      setSaveMessage(revokeError instanceof Error ? revokeError.message : "Revoke failed.");
    } finally {
      setRevokingVideoId(null);
    }
  }

  function seekPendingPreview(seconds: number) {
    const iframeWindow = pendingPreviewIframeRef.current?.contentWindow;
    if (!iframeWindow) {
      return;
    }

    iframeWindow.postMessage(
      JSON.stringify({ event: "command", func: "seekTo", args: [seconds, true] }),
      "*",
    );
    iframeWindow.postMessage(
      JSON.stringify({ event: "command", func: "playVideo", args: [] }),
      "*",
    );
  }

  function seekCatalogReviewPreview(seconds: number) {
    const iframeWindow = catalogReviewPreviewIframeRef.current?.contentWindow;
    if (!iframeWindow) {
      return;
    }

    iframeWindow.postMessage(
      JSON.stringify({ event: "command", func: "seekTo", args: [seconds, true] }),
      "*",
    );
    iframeWindow.postMessage(
      JSON.stringify({ event: "command", func: "playVideo", args: [] }),
      "*",
    );
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleYouTubeInfoDelivery = (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        return;
      }

      if (!event.origin.includes("youtube.com")) {
        return;
      }

      try {
        const payload = JSON.parse(event.data) as {
          event?: string;
          info?: { currentTime?: number };
        };

        if (payload.event !== "infoDelivery") {
          return;
        }

        const currentTime = payload.info?.currentTime;
        if (typeof currentTime === "number" && Number.isFinite(currentTime)) {
          pendingPreviewCurrentTimeRef.current = currentTime;
          catalogReviewPreviewCurrentTimeRef.current = currentTime;
        }
      } catch {
        // Ignore non-JSON/non-YouTube messages.
      }
    };

    window.addEventListener("message", handleYouTubeInfoDelivery);
    return () => {
      window.removeEventListener("message", handleYouTubeInfoDelivery);
    };
  }, []);

  async function loadMagazineArticles() {
    const payload = await readJson<{ articles: AdminMagazineArticleRow[] }>("/api/admin/magazine");
    setMagazineArticles(payload.articles);
  }

  async function loadQuotaStatus() {
    try {
      const status = await readJson<QuotaBackfillStatus & { ok: boolean }>("/api/admin/videos/backfill-quota");
      setQuotaStatus(status);
      setMsUntilReset(status.msUntilReset);
    } catch {
      // non-fatal
    }
  }

  async function triggerBackfill(budgetUnits: number) {
    if (backfillRunning || budgetUnits < 100) {
      return;
    }

    setBackfillRunning(true);
    setBackfillResult(null);

    try {
      const result = await postJson<{
        ok: boolean;
        seedsAttempted: number;
        fetchedNodes: number;
        discoveredNewVideos: number;
        unitsEstimated: number;
      }>("/api/admin/videos/backfill-quota", { budgetUnits });

      setBackfillResult(
        `Backfill complete — ${result.seedsAttempted} seeds, ${result.discoveredNewVideos} new videos found, ~${result.unitsEstimated} units used.`,
      );
    } catch (backfillError) {
      setBackfillResult(backfillError instanceof Error ? backfillError.message : "Backfill failed.");
    } finally {
      setBackfillRunning(false);
      void loadQuotaStatus();
    }
  }

  async function loadActiveTab() {
    setLoading(true);
    setError(null);

    try {
      if (activeTab === "overview") {
        await loadOverview();
      } else if (activeTab === "magazine") {
        await loadMagazineArticles();
      } else if (activeTab === "performance") {
        await loadOverview();
      } else if (activeTab === "worldmap") {
        await loadOverview();
      } else if (activeTab === "api") {
        await Promise.all([loadOverview(), loadQuotaStatus()]);
      } else if (activeTab === "categories") {
        await loadCategories();
      } else if (activeTab === "videos") {
        await Promise.all([loadPendingVideos(), loadRecentlyApprovedVideos()]);
      } else if (activeTab === "catalog-review") {
        await loadCatalogReviewQueue();
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load admin data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadActiveTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, refreshOverviewAnalytics]);

  // Use orchestration hook for API tab polling
  useAdminApiTabPolling({
    activeTab,
    quotaStatus,
    onTickMsUntilReset: setMsUntilReset,
    onLoadQuotaStatus: loadQuotaStatus,
    onTriggerBackfill: triggerBackfill,
  });

  const handleAdminHealthPayload = useCallback((payload: {
    meta?: { generatedAt?: string };
    health?: {
      nodeUptimeSec: number;
      memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
      host: {
        platform: string;
        loadAvg: number[];
        totalMemMb: number;
        freeMemMb: number;
        cpuUsagePercent: number | null;
        cpuAverageUsagePercent: number | null;
        cpuPeakCoreUsagePercent: number | null;
        memoryUsagePercent: number;
        diskUsagePercent: number | null;
        swapUsagePercent: number | null;
        networkUsagePercent: number | null;
      };
    };
  }) => {
    if (!payload?.health) {
      return;
    }

    const health = payload.health;
    const sanitizedHost = {
      platform: health.host.platform || "unknown",
      loadAvg: health.host.loadAvg || [],
      totalMemMb: health.host.totalMemMb || 0,
      freeMemMb: health.host.freeMemMb || 0,
      cpuUsagePercent: finiteOrNull(health.host.cpuUsagePercent),
      cpuAverageUsagePercent: finiteOrNull(health.host.cpuAverageUsagePercent),
      cpuPeakCoreUsagePercent: finiteOrNull(health.host.cpuPeakCoreUsagePercent),
      memoryUsagePercent: finiteOrNull(health.host.memoryUsagePercent) ?? 0,
      diskUsagePercent: finiteOrNull(health.host.diskUsagePercent),
      swapUsagePercent: finiteOrNull(health.host.swapUsagePercent),
      networkUsagePercent: finiteOrNull(health.host.networkUsagePercent),
    };

    setDashboard((previous) => {
      if (!previous) {
        return previous;
      }

      return {
        ...previous,
        health: {
          nodeUptimeSec: health.nodeUptimeSec,
          memory: health.memory,
          host: sanitizedHost,
        },
        meta: {
          ...previous.meta,
          generatedAt: payload.meta?.generatedAt ?? previous.meta.generatedAt,
        },
      };
    });
  }, []);

  // Use orchestration hook for health streaming
  useAdminHealthStreaming({
    activeTab,
    onHealthPayload: handleAdminHealthPayload,
  });

  // Use orchestration hook for video queue polling
  useAdminVideoQueuePolling({
    activeTab,
    onRefresh: async () => {
      try {
        if (activeTab === "videos") {
          await Promise.all([loadPendingVideos(), loadRecentlyApprovedVideos()]);
        } else if (activeTab === "catalog-review") {
          await loadCatalogReviewQueue();
        }
        // Clear error on successful poll
        if (error?.includes("Unauthorized")) {
          setError(null);
        }
      } catch (pollError) {
        if (isAuthResponseError(pollError)) {
          setError("Unauthorized. Please sign in again.");
          throw pollError;
        }
        // Keep the current admin data visible on transient polling failures.
      }
    },
  });

  // Use orchestration hook for analytics refresh
  useAdminAnalyticsRefresh({
    activeTab,
    onRefresh: refreshOverviewAnalytics,
  });

  async function patchJson(url: string, body: Record<string, unknown>) {
    await readJson(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function postJson<T>(url: string, body: Record<string, unknown>) {
    return readJson<T>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function saveCategory(row: CategoryRow) {
    try {
      await patchJson("/api/admin/categories", row);
      setSaveMessage(`Saved category ${row.genre}.`);
      await loadCategories();
    } catch (saveError) {
      setSaveMessage(saveError instanceof Error ? saveError.message : "Category save failed.");
    }
  }

  async function saveVideo(row: VideoRow) {
    try {
      await patchJson("/api/admin/videos", row);
      setSaveMessage(`Saved video ${row.videoId}.`);
      await Promise.all([loadVideos(), loadPendingVideos()]);
    } catch (saveError) {
      setSaveMessage(saveError instanceof Error ? saveError.message : "Video save failed.");
    }
  }

  async function importVideoFromSource() {
    const source = videoImportSource.trim();
    if (!source) {
      setSaveMessage("Paste a YouTube URL or video id first.");
      return;
    }

    setIngestingVideo(true);

    try {
      const response = await postJson<{
        ok: boolean;
        videoId: string;
        decision?: { allowed: boolean; reason: string; message?: string };
      }>("/api/admin/videos/import", { source });

      if (response.ok) {
        setSaveMessage(`Imported video ${response.videoId}.`);
      } else {
        const detail = response.decision?.message ?? response.decision?.reason ?? "Video cannot be imported.";
        setSaveMessage(`Import blocked for ${response.videoId}: ${detail}`);
      }

      setVideoImportSource("");
      await Promise.all([loadVideos(), loadPendingVideos()]);
    } catch (importError) {
      setSaveMessage(importError instanceof Error ? importError.message : "Video import failed.");
    } finally {
      setIngestingVideo(false);
    }
  }

  async function moderatePendingVideo(row: PendingVideoRow, action: "approve" | "remove") {
    const videoId = row.videoId;
    setModeratingVideoId(videoId);

    try {
      const draft = pendingVideoDrafts[row.id];
      const titleToApprove = (draft?.title ?? row.title).trim();
      // Use draft value if a draft exists (even if artist was cleared to null/empty),
      // only fall back to row value when the user has never touched this row.
      const parsedArtistToApprove = (draft !== undefined ? (draft.parsedArtist ?? "") : (row.parsedArtist ?? "")).trim() || null;
      const parsedTrackToApprove = (draft !== undefined ? (draft.parsedTrack ?? "") : (row.parsedTrack ?? "")).trim() || null;

      const payload: {
        videoId: string;
        action: "approve" | "remove";
        title?: string;
        parsedArtist?: string | null;
        parsedTrack?: string | null;
      } = { videoId, action };

      if (action === "approve") {
        payload.title = titleToApprove;
        payload.parsedArtist = parsedArtistToApprove;
        payload.parsedTrack = parsedTrackToApprove;
      }

      await postJson<{ ok: boolean }>("/api/admin/videos/pending", payload);
      setPendingVideoDrafts((current) => {
        if (!(row.id in current)) {
          return current;
        }

        const next = { ...current };
        delete next[row.id];
        return next;
      });
      setSaveMessage(action === "approve" ? `Approved ${videoId}.` : `Removed ${videoId}.`);
      await Promise.all([loadPendingVideos(), loadVideos()]);
    } catch (moderationError) {
      setSaveMessage(moderationError instanceof Error ? moderationError.message : "Pending moderation action failed.");
    } finally {
      setModeratingVideoId(null);
    }
  }

  async function deleteMagazineArticle(slug: string) {
    try {
      await readJson(`/api/admin/magazine/${encodeURIComponent(slug)}`, {
        method: "DELETE",
      });
      setSaveMessage(`Deleted magazine article ${slug}.`);
      setDeleteModalSlug(null);
      await loadMagazineArticles();
    } catch (deleteError) {
      setSaveMessage(deleteError instanceof Error ? deleteError.message : "Delete failed.");
    }
  }

  async function resetPerfWindow() {
    if (resettingPerfWindow) {
      return;
    }

    setResettingPerfWindow(true);
    setSaveMessage(null);

    try {
      const result = await postJson<PerfWindowResetResponse>("/api/admin/performance-samples", {});
      if (!result.slowLog.enabled) {
        setSaveMessage(`MySQL slow-log start could not be verified from the app: ${result.slowLog.warning ?? "unknown error"}`);
      }
      await refreshOverviewAnalytics();
    } catch (resetError) {
      setSaveMessage(resetError instanceof Error ? resetError.message : "Could not reset performance window.");
    } finally {
      setResettingPerfWindow(false);
    }
  }

  if (loading) {
    return <p className="authMessage">Loading admin dashboard...</p>;
  }

  if (error) {
    return <p className="authMessage">{error}</p>;
  }

  return (
    <div className="interactiveStack">
      {saveMessage ? <p className="authMessage">{saveMessage}</p> : null}

      {activeTab === "overview" ? (
        <div className="adminOverviewStack">
          <div className="adminOverviewHealthLayout">
            <div className="adminOverviewDialsColumn">
              <div className="adminOverviewDials">
                <Dial label="Memory" value={dashboard?.health.host.memoryUsagePercent ?? null} color="#ffc14d" />
                <Dial label="Swap" value={dashboard?.health.host.swapUsagePercent ?? null} color="#f5d96b" />
                <Dial label="CPU" value={finiteOrNull(dashboard?.health.host.cpuUsagePercent)} color="#ff6f43" detail={cpuAvgPeakText} />
                <Dial label="Disk" value={dashboard?.health.host.diskUsagePercent ?? null} color="#7ce0a3" />
                <Dial label="Network" value={dashboard?.health.host.networkUsagePercent ?? null} color="#5fc1ff" />
              </div>
              <div className="adminOverviewGraphToggleRow">
                <button
                  type="button"
                  onClick={() => setShowHostMetricsGraph((previous) => !previous)}
                  style={{
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: showHostMetricsGraph ? "rgba(95,193,255,0.14)" : "rgba(255,255,255,0.04)",
                    color: showHostMetricsGraph ? "#5fc1ff" : "rgba(255,255,255,0.82)",
                    padding: "7px 12px",
                    cursor: "pointer",
                  }}
                >
                  {showHostMetricsGraph ? "Hide 24h graph" : "View 24h graph"}
                </button>
              </div>
            </div>
            <div className="statusMetrics">
              <div><strong>Registered Users</strong><p>{dashboard?.counts.registeredUsers ?? 0}</p></div>
              <div><strong>Anonymous Users</strong><p>{dashboard?.counts.anonymousUsers ?? 0}</p></div>
              <div><strong>Videos</strong><p>{dashboard?.counts.videos ?? 0}</p></div>
              <div><strong>Artists</strong><p>{dashboard?.counts.artists ?? 0}</p></div>
            </div>
          </div>



          {showHostMetricsGraph ? (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <span style={{ fontSize: 11, opacity: 0.5, letterSpacing: "0.06em", textTransform: "uppercase" }}>Host metrics · last 24 hours · 1 minute buckets</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {([
                    { key: "cpu", label: "CPU", color: "#ff6f43" },
                    { key: "memory", label: "Memory", color: "#ffc14d" },
                    { key: "swap", label: "Swap", color: "#f5d96b" },
                    { key: "disk", label: "Disk", color: "#7ce0a3" },
                    { key: "network", label: "Network", color: "#5fc1ff" },
                  ] as Array<{ key: keyof typeof hostMetricSeriesOn; label: string; color: string }>).map(({ key, label, color }) => (
                    <button
                      key={`host-metric-${key}`}
                      type="button"
                      onClick={() => setHostMetricSeriesOn((previous) => ({ ...previous, [key]: !previous[key] }))}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "3px 8px",
                        borderRadius: 20,
                        border: `1px solid ${hostMetricSeriesOn[key] ? color : "rgba(255,255,255,0.12)"}`,
                        background: hostMetricSeriesOn[key] ? `${color}22` : "transparent",
                        color: hostMetricSeriesOn[key] ? color : "rgba(255,255,255,0.35)",
                        fontSize: 11,
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      <svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke={hostMetricSeriesOn[key] ? color : "rgba(255,255,255,0.25)"} strokeWidth="2" strokeDasharray={hostMetricSeriesOn[key] ? undefined : "3 2"} /></svg>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <svg
                viewBox={hostMetricRows.length > 0 ? `0 0 ${hostMetricsGraph.width} ${hostMetricsGraph.height}` : "0 0 680 220"}
                role="img"
                aria-label="Host metrics chart — CPU, memory, swap, disk, network over the last 24 hours"
                style={{ width: "100%", height: "clamp(250px, 42vh, 560px)", borderRadius: 10, background: "rgba(255,255,255,0.04)" }}
              >
                {hostMetricRows.length === 0 ? (
                  <text x="340" y="110" textAnchor="middle" fill="rgba(255,255,255,0.2)" style={{ fontSize: 13 }}>Collecting host metric history...</text>
                ) : (
                  <>
                    {hostMetricsGraph.yTicks.map((tick) => (
                      <g key={`hy-${tick.value}-${tick.y.toFixed(1)}`}>
                        <line x1={String(hostMetricsGraph.axis.paddingLeft)} y1={String(tick.y)} x2={String(hostMetricsGraph.width - hostMetricsGraph.axis.paddingRight)} y2={String(tick.y)} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
                        <text x={String(hostMetricsGraph.axis.paddingLeft - 6)} y={String(tick.y + 3)} textAnchor="end" fill="rgba(255,255,255,0.78)" style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}>{tick.value}%</text>
                      </g>
                    ))}
                    {hostMetricsGraph.xTicks.map((tick) => (
                      <g key={`hx-${tick.label}-${tick.x.toFixed(1)}`}>
                        <line x1={String(tick.x)} y1={String(hostMetricsGraph.axis.paddingTop)} x2={String(tick.x)} y2={String(hostMetricsGraph.height - hostMetricsGraph.axis.paddingBottom)} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                        <text x={String(tick.x)} y={String(hostMetricsGraph.height - 13)} textAnchor="middle" fill="rgba(255,255,255,0.72)" fontSize="5" fontWeight="500">{tick.label}</text>
                      </g>
                    ))}
                    <line x1={String(hostMetricsGraph.axis.paddingLeft)} y1={String(hostMetricsGraph.axis.paddingTop)} x2={String(hostMetricsGraph.axis.paddingLeft)} y2={String(hostMetricsGraph.height - hostMetricsGraph.axis.paddingBottom)} stroke="rgba(255,255,255,0.24)" strokeWidth="1" />
                    <line x1={String(hostMetricsGraph.axis.paddingLeft)} y1={String(hostMetricsGraph.height - hostMetricsGraph.axis.paddingBottom)} x2={String(hostMetricsGraph.width - hostMetricsGraph.axis.paddingRight)} y2={String(hostMetricsGraph.height - hostMetricsGraph.axis.paddingBottom)} stroke="rgba(255,255,255,0.24)" strokeWidth="1" />
                    {hostMetricSeriesOn.cpu && <path d={hostMetricsGraph.cpuPath} fill="none" stroke="#ff6f43" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />}
                    {hostMetricSeriesOn.memory && <path d={hostMetricsGraph.memoryPath} fill="none" stroke="#ffc14d" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />}
                    {hostMetricSeriesOn.swap && <path d={hostMetricsGraph.swapPath} fill="none" stroke="#f5d96b" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />}
                    {hostMetricSeriesOn.disk && <path d={hostMetricsGraph.diskPath} fill="none" stroke="#7ce0a3" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />}
                    {hostMetricSeriesOn.network && <path d={hostMetricsGraph.networkPath} fill="none" stroke="#5fc1ff" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />}
                  </>
                )}
              </svg>
            </div>
          ) : null}

          {/* Analytics Chart */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 11, opacity: 0.5, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {analyticsZoomLevel === "allTime"
                ? "User analytics · all time overview"
                : analyticsZoomLevel === "monthly"
                  ? "User analytics · rolling monthly buckets"
                  : analyticsZoomLevel === "weekly"
                    ? "User analytics · rolling weekly buckets"
                    : analyticsZoomLevel === "daily"
                        ? ""
                      : "User analytics · recent hourly buckets"}
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
              {([
                { key: "allTime", label: "All time" },
                { key: "monthly", label: "Monthly" },
                { key: "weekly", label: "Weekly" },
                { key: "daily", label: "Daily" },
                { key: "hourly", label: "Hourly" },
              ] as Array<{ key: AnalyticsZoomLevel; label: string }>).map(({ key, label }) => (
                <button
                  key={`analytics-zoom-${key}`}
                  type="button"
                  onClick={() => {
                    setAnalyticsZoomLevel(key);
                    setSelectedAllTimeBucket(null);
                    setSelectedMonthlyBucket(null);
                    setSelectedWeeklyBucket(null);
                  }}
                  style={{
                    borderRadius: 999,
                    border: `1px solid ${analyticsZoomLevel === key ? "rgba(255,157,92,0.6)" : "rgba(255,255,255,0.12)"}`,
                    background: analyticsZoomLevel === key ? "rgba(255,157,92,0.16)" : "transparent",
                    color: analyticsZoomLevel === key ? "#ff9d5c" : "rgba(255,255,255,0.78)",
                    padding: "6px 11px",
                    cursor: "pointer",
                    fontSize: 11,
                  }}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  void refreshOverviewAnalytics();
                }}
                disabled={refreshingAnalytics}
                style={{
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.04)",
                  color: "rgba(255,255,255,0.9)",
                  padding: "7px 12px",
                  cursor: refreshingAnalytics ? "wait" : "pointer",
                }}
              >
                {refreshingAnalytics ? "Refreshing..." : "Refresh"}
              </button>
              {(([
                { key: "pageViews", label: "Page Views", color: "#ff9d5c" },
                { key: "videoViews", label: "Video Views", color: "#5fc1ff" },
                { key: "visitors", label: "Unique Visitors", color: "#7ce0a3" },
                { key: "returnVisits", label: "Return Visits", color: "#9e86ff" },
                { key: "magazineExternalLandings", label: "Magazine External Landings", color: "#ff4d4d" },
                { key: "authEvents", label: "Auth Events", color: "#ffd1c4" },
              ]) as Array<{ key: keyof typeof analyticsSeriesOn; label: string; color: string }>).map(({ key, label, color }) => (
                <button
                  key={key}
                  onClick={() => setAnalyticsSeriesOn((prev) => ({ ...prev, [key]: !prev[key] }))}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "3px 8px",
                    borderRadius: 20,
                    border: `1px solid ${analyticsSeriesOn[key] ? color : "rgba(255,255,255,0.12)"}`,
                    background: analyticsSeriesOn[key] ? `${color}22` : "transparent",
                    color: analyticsSeriesOn[key] ? color : "rgba(255,255,255,0.35)",
                    fontSize: 11,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  <svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke={analyticsSeriesOn[key] ? color : "rgba(255,255,255,0.25)"} strokeWidth="2" strokeDasharray={analyticsSeriesOn[key] ? undefined : "3 2"} /></svg>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <p className="authMessage" style={{ margin: 0 }}>
            {analyticsZoomLevel === "allTime"
              ? "Click a bucket to zoom into monthly traffic."
              : analyticsZoomLevel === "monthly"
                ? "Click a bucket to zoom into weekly traffic for that month window."
                : analyticsZoomLevel === "weekly"
                  ? "Click a bucket to zoom into daily traffic for that week window."
                  : analyticsZoomLevel === "daily"
                    ? ""
                    : "Showing the latest 24 hourly buckets."}
          </p>

          <svg
            viewBox={analyticsGraph.points.length > 0 ? `0 0 ${analyticsGraph.width} ${analyticsGraph.height}` : "0 0 680 250"}
            role="img"
            aria-label="Analytics chart — page views, video views, unique visitors, return visits, magazine external landings, auth events"
            style={{ width: "100%", height: "clamp(260px, 46vh, 620px)", borderRadius: 10, background: "rgba(255,255,255,0.04)" }}
          >
            {analyticsGraph.points.length === 0 ? (
              <text x="340" y="130" textAnchor="middle" fill="rgba(255,255,255,0.2)" style={{ fontSize: 13 }}>No data yet</text>
            ) : (
              <>
                {analyticsGraph.yTicks.map((tick) => (
                  <g key={`ay-${tick.value}-${tick.y.toFixed(1)}`}>
                    <line x1={String(analyticsGraph.axis.paddingLeft)} y1={String(tick.y)} x2={String(analyticsGraph.width - analyticsGraph.axis.paddingRight)} y2={String(tick.y)} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
                    <text x={String(analyticsGraph.axis.paddingLeft - 6)} y={String(tick.y + 3)} textAnchor="end" fill="rgba(255,255,255,0.78)" style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}>{tick.value}</text>
                  </g>
                ))}
                {analyticsGraph.xTicks.map((tick) => (
                  <g key={`ax-${tick.label}-${tick.x.toFixed(1)}`}>
                    <line x1={String(tick.x)} y1={String(analyticsGraph.axis.paddingTop)} x2={String(tick.x)} y2={String(analyticsGraph.height - analyticsGraph.axis.paddingBottom)} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                    <text x={String(tick.x)} y={String(analyticsGraph.height - 34)} textAnchor="end" fill="rgba(255,255,255,0.72)" transform={`rotate(-45 ${tick.x} ${analyticsGraph.height - 34})`} fontSize="7" fontWeight="500">{tick.label}</text>
                  </g>
                ))}
                <line x1={String(analyticsGraph.axis.paddingLeft)} y1={String(analyticsGraph.axis.paddingTop)} x2={String(analyticsGraph.axis.paddingLeft)} y2={String(analyticsGraph.height - analyticsGraph.axis.paddingBottom)} stroke="rgba(255,255,255,0.24)" strokeWidth="1" />
                <line x1={String(analyticsGraph.axis.paddingLeft)} y1={String(analyticsGraph.height - analyticsGraph.axis.paddingBottom)} x2={String(analyticsGraph.width - analyticsGraph.axis.paddingRight)} y2={String(analyticsGraph.height - analyticsGraph.axis.paddingBottom)} stroke="rgba(255,255,255,0.24)" strokeWidth="1" />
                {analyticsSeriesOn.pageViews && <path d={analyticsGraph.pageViewsPath} fill="none" stroke="#ff9d5c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
                {analyticsSeriesOn.videoViews && <path d={analyticsGraph.videoViewsPath} fill="none" stroke="#5fc1ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
                {analyticsSeriesOn.visitors && <path d={analyticsGraph.visitorsPath} fill="none" stroke="#7ce0a3" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
                {analyticsSeriesOn.returnVisits && <path d={analyticsGraph.returnVisitsPath} fill="none" stroke="#9e86ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
                {analyticsSeriesOn.magazineExternalLandings && <path d={analyticsGraph.magazineExternalLandingsPath} fill="none" stroke="#ff4d4d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
                {analyticsSeriesOn.authEvents && <path d={analyticsGraph.authEventsPath} fill="none" stroke="#ffd1c4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
                {analyticsGraph.points.map((point) => (
                  <g
                    key={`${point.bucketStart}-${point.bucketEnd}`}
                    onClick={() => {
                      if (analyticsZoomLevel === "allTime") {
                        setSelectedAllTimeBucket({
                          bucketStart: point.bucketStart,
                          bucketEnd: point.bucketEnd,
                          label: point.label,
                          pageViews: point.pageViews,
                          videoViews: point.videoViews,
                          uniqueVisitors: point.uniqueVisitors,
                          returnVisits: point.returnVisits,
                          magazineExternalLandings: point.magazineExternalLandings,
                          authEvents: point.authEvents,
                        });
                        setSelectedMonthlyBucket(null);
                        setSelectedWeeklyBucket(null);
                        setAnalyticsZoomLevel("monthly");
                        return;
                      }

                      if (analyticsZoomLevel === "monthly") {
                        setSelectedMonthlyBucket({
                          bucketStart: point.bucketStart,
                          bucketEnd: point.bucketEnd,
                          label: point.label,
                          pageViews: point.pageViews,
                          videoViews: point.videoViews,
                          uniqueVisitors: point.uniqueVisitors,
                          returnVisits: point.returnVisits,
                          magazineExternalLandings: point.magazineExternalLandings,
                          authEvents: point.authEvents,
                        });
                        setSelectedWeeklyBucket(null);
                        setAnalyticsZoomLevel("weekly");
                        return;
                      }

                      if (analyticsZoomLevel === "weekly") {
                        setSelectedWeeklyBucket({
                          bucketStart: point.bucketStart,
                          bucketEnd: point.bucketEnd,
                          label: point.label,
                          pageViews: point.pageViews,
                          videoViews: point.videoViews,
                          uniqueVisitors: point.uniqueVisitors,
                          returnVisits: point.returnVisits,
                          magazineExternalLandings: point.magazineExternalLandings,
                          authEvents: point.authEvents,
                        });
                        setAnalyticsZoomLevel("daily");
                      }
                    }}
                    style={{ cursor: analyticsZoomLevel === "allTime" || analyticsZoomLevel === "monthly" || analyticsZoomLevel === "weekly" ? "pointer" : "default" }}
                  >
                    {analyticsSeriesOn.pageViews && <circle cx={point.x} cy={point.yPageViews} r="3.5" fill="#ff9d5c" />}
                    {analyticsSeriesOn.videoViews && <circle cx={point.x} cy={point.yVideoViews} r="3.5" fill="#5fc1ff" />}
                    {analyticsSeriesOn.visitors && <circle cx={point.x} cy={point.yVisitors} r="3.5" fill="#7ce0a3" />}
                    {analyticsSeriesOn.returnVisits && <circle cx={point.x} cy={point.yReturnVisits} r="3.5" fill="#9e86ff" />}
                    {analyticsSeriesOn.magazineExternalLandings && <circle cx={point.x} cy={point.yMagazineExternalLandings} r="3.5" fill="#ff4d4d" />}
                    {analyticsSeriesOn.authEvents && <circle cx={point.x} cy={point.yAuthEvents} r="3.5" fill="#ffd1c4" />}
                    <title>{`${point.label} (${new Date(point.bucketStart).toLocaleString()} - ${new Date(point.bucketEnd).toLocaleString()}) — Page views: ${point.pageViews}, Video views: ${point.videoViews}, Visitors: ${point.uniqueVisitors}, Return visits: ${point.returnVisits}, Magazine external landings: ${point.magazineExternalLandings}, Auth events: ${point.authEvents}`}</title>
                  </g>
                ))}
              </>
            )}
          </svg>

        </div>
      ) : null}

      {activeTab === "magazine" ? (
        <section className="panel featurePanel">
          <div className="panelHeading">
            <span>Magazine Articles</span>
            <strong>{magazineArticles.length} rows</strong>
          </div>
          <div className="interactiveStack" style={{ gap: 8 }}>
            {magazineArticles.length === 0 ? <p className="authMessage">No magazine articles found.</p> : null}
            {magazineArticles.map((article) => (
              <div
                key={article.slug}
                style={{
                  display: "grid",
                  gridTemplateColumns: "72px minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 10,
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 10,
                  padding: 8,
                  background: "rgba(0,0,0,0.22)",
                }}
              >
                {article.videoId ? (
                  <img
                    src={`https://i.ytimg.com/vi/${article.videoId}/mqdefault.jpg`}
                    alt={article.title}
                    style={{ width: 72, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)" }}
                  />
                ) : (
                  <div style={{ width: 72, height: 40, borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)" }} />
                )}

                <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
                  <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{article.title}</strong>
                  <span className="authMessage" style={{ margin: 0 }}>
                    External landings (all time): {article.externalLandings.toLocaleString()}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Link href={`/admin/magazine/${encodeURIComponent(article.slug)}`} className="navLink navLinkActive">
                    Edit
                  </Link>
                  <button
                    type="button"
                    onClick={() => setDeleteModalSlug(article.slug)}
                    style={{
                      borderRadius: 999,
                      border: "1px solid rgba(255, 105, 97, 0.72)",
                      background: "rgba(102, 10, 10, 0.55)",
                      color: "#ffd8d3",
                      padding: "6px 11px",
                      cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {deleteModalSlug ? (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Confirm article deletion"
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.62)",
                display: "grid",
                placeItems: "center",
                zIndex: 160,
                padding: 16,
              }}
            >
              <div
                style={{
                  width: "min(520px, 100%)",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "linear-gradient(170deg, rgba(30,10,10,0.96), rgba(12,6,6,0.98))",
                  boxShadow: "0 22px 52px rgba(0,0,0,0.45)",
                  padding: 16,
                  display: "grid",
                  gap: 10,
                }}
              >
                <h3 style={{ margin: 0 }}>Delete article?</h3>
                <p className="authMessage" style={{ margin: 0 }}>
                  This will permanently delete <strong>{deleteModalSlug}</strong>. This action cannot be undone.
                </p>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" onClick={() => setDeleteModalSlug(null)}>Cancel</button>
                  <button
                    type="button"
                    onClick={() => void deleteMagazineArticle(deleteModalSlug)}
                    style={{
                      border: "1px solid rgba(255, 105, 97, 0.72)",
                      background: "rgba(102, 10, 10, 0.7)",
                      color: "#ffd8d3",
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === "performance" ? (
        <>
          <section className="panel featurePanel">
            <div className="interactiveStack">
              <div className="primaryActions compactActions" style={{ justifyContent: "center" }}>
                <button
                  type="button"
                  onClick={() => {
                    void resetPerfWindow();
                  }}
                  disabled={resettingPerfWindow}
                  className="navLink navLinkActive"
                  style={{
                    borderColor: "rgba(255,111,67,0.45)",
                    background: "rgba(255,111,67,0.12)",
                    color: "#ffb08f",
                    cursor: resettingPerfWindow ? "wait" : "pointer",
                  }}
                >
                  {resettingPerfWindow ? "Resetting..." : "Start fresh capture"}
                </button>
              </div>
            </div>
          </section>

          {dashboard?.insights.memoryDiagnostics ? (
            <section className="panel featurePanel" style={{ marginTop: 6 }}>
              <div className="panelHeading">
                <span>Leak Diagnostics Snapshot</span>
                <strong>{new Date(dashboard.insights.memoryDiagnostics.snapshotAt).toLocaleTimeString()}</strong>
              </div>
              <div className="statusMetrics">
                <div><strong>RSS / Heap</strong><p>{dashboard.insights.memoryDiagnostics.process.rssMb}MB / {dashboard.insights.memoryDiagnostics.process.heapUsedMb}MB</p></div>
                <div><strong>Current-video caches</strong><p>{dashboard.insights.memoryDiagnostics.caches.currentVideo.currentVideoCache + dashboard.insights.memoryDiagnostics.caches.currentVideo.currentVideoPendingCache + dashboard.insights.memoryDiagnostics.caches.currentVideo.currentVideoRelatedPoolCache}</p></div>
                <div><strong>Artist heavy cache</strong><p>{dashboard.insights.memoryDiagnostics.caches.artist.sizes.artistVideosCache} / {dashboard.insights.memoryDiagnostics.caches.artist.limits.heavyMaxEntries}</p></div>
                <div><strong>Artist letter/search</strong><p>{dashboard.insights.memoryDiagnostics.caches.artist.sizes.artistLetterPageCache + dashboard.insights.memoryDiagnostics.caches.artist.sizes.artistSearchCache}</p></div>
                <div><strong>Geo cache</strong><p>{dashboard.insights.memoryDiagnostics.caches.analyticsGeo.size} / {dashboard.insights.memoryDiagnostics.caches.analyticsGeo.maxEntries}</p></div>
                <div><strong>Wiki cache files</strong><p>{dashboard.insights.memoryDiagnostics.caches.wikiCacheCount}</p></div>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {activeTab === "worldmap" ? (
        <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {([
                { key: "allTime", label: "All time" },
                { key: "today", label: "Today" },
                { key: "thisWeek", label: "This week" },
                { key: "thisMonth", label: "This month" },
                { key: "thisYear", label: "This year" },
              ] as Array<{ key: MapDateRange; label: string }>).map(({ key, label }) => (
                <button
                  key={`map-range-${key}`}
                  type="button"
                  onClick={() => setMapDateRange(key)}
                  style={{
                    borderRadius: 999,
                    border: `1px solid ${mapDateRange === key ? "rgba(255,77,77,0.8)" : "rgba(255,255,255,0.2)"}`,
                    background: mapDateRange === key ? "rgba(255,0,0,0.16)" : "rgba(0,0,0,0.35)",
                    color: mapDateRange === key ? "#ff5a5a" : "rgba(255,255,255,0.82)",
                    padding: "6px 11px",
                    cursor: "pointer",
                    fontSize: 11,
                    letterSpacing: "0.03em",
                    textTransform: "uppercase",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <svg
              viewBox={`0 0 ${worldMap.width} ${worldMap.height}`}
              role="img"
              aria-label="World map of visitor geolocation points"
              style={{
                width: "100%",
                height: "auto",
                borderRadius: 10,
                background: "radial-gradient(circle at 20% 10%, rgba(95,193,255,0.2), rgba(7,16,25,0.96))",
              }}
            >
              <defs>
                <linearGradient id="map-grid" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.12)" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0.04)" />
                </linearGradient>
              </defs>
              {worldMap.parallels.map((y) => (
                <line key={`parallel-${y.toFixed(2)}`} x1="0" y1={String(y)} x2={String(worldMap.width)} y2={String(y)} stroke="url(#map-grid)" strokeWidth="1" />
              ))}
              {worldMap.meridians.map((x) => (
                <line key={`meridian-${x.toFixed(2)}`} x1={String(x)} y1="0" x2={String(x)} y2={String(worldMap.height)} stroke="url(#map-grid)" strokeWidth="1" />
              ))}
              {worldMap.countries.map((country) => (
                <path
                  key={`country-${country.renderKey}`}
                  d={country.path}
                  fill={worldMap.getCountryFill(country.id)}
                  stroke="rgba(255,255,255,0.34)"
                  strokeWidth="0.85"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                >
                  <title>{`${country.name}: ${worldMap.countryVisitorCount.get(country.id) ?? 0} visitors`}</title>
                </path>
              ))}
            </svg>
            <div className="statusMetrics">
              <div><strong>Tracked Visitors</strong><p>{filteredWorldMapVisitors.length}</p></div>
              <div><strong>Regions With Traffic</strong><p>{Array.from(worldMap.countryVisitorCount.values()).filter((count) => count > 0).length}</p></div>
              <div><strong>Max Visitors / Region</strong><p>{worldMap.maxCountryVisitors}</p></div>
            </div>
        </div>
      ) : null}

      {activeTab === "api" ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div className="statusMetrics">
            <div><strong>YouTube units (7d)</strong><p>{apiUsageTotals7d?.youtubeUnits ?? 0}</p></div>
            <div><strong>YouTube errors (7d)</strong><p>{apiUsageTotals7d?.youtubeErrors ?? 0}</p></div>
            <div><strong>Groq calls (7d)</strong><p>{apiUsageTotals7d?.groqCalls ?? 0}</p></div>
            <div><strong>Groq classified (7d)</strong><p>{apiUsageTotals7d?.groqClassified ?? 0}</p></div>
            <div><strong>YouTube success</strong><p>{apiUsageTotals7d?.youtubeSuccessRate ?? 100}%</p></div>
            <div><strong>Groq success</strong><p>{apiUsageTotals7d?.groqSuccessRate ?? 100}%</p></div>
          </div>

          {apiUsageGraph.bars.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <svg
                viewBox={`0 0 ${apiUsageGraph.width} ${apiUsageGraph.height}`}
                style={{ width: "100%", minWidth: 680, height: "auto", borderRadius: 10, background: "rgba(0,0,0,0.32)" }}
                role="img"
                aria-label="API usage chart for YouTube and Groq"
              >
                {apiUsageGraph.yTicks.map((tick) => (
                  <g key={`api-y-${tick.value}`}>
                    <line
                      x1={apiUsageGraph.axis.paddingLeft}
                      x2={apiUsageGraph.width - apiUsageGraph.axis.paddingRight}
                      y1={tick.y}
                      y2={tick.y}
                      stroke="rgba(255,255,255,0.12)"
                    />
                    <text x={apiUsageGraph.axis.paddingLeft - 8} y={tick.y + 4} textAnchor="end" fill="rgba(255,255,255,0.62)" style={{ fontSize: 11 }}>
                      {tick.value}
                    </text>
                  </g>
                ))}

                {apiUsageGraph.bars.map((bar, index) => {
                  const yBase = apiUsageGraph.axis.paddingTop + apiUsageGraph.chartHeight;
                  const bw = apiUsageGraph.barWidth;

                  return (
                    <g key={`api-bar-${bar.label}-${index}`}>
                      <rect x={bar.x} y={yBase - bar.youtubeHeight} width={bw} height={bar.youtubeHeight} fill="#ff6f43">
                        <title>{`${bar.label} YouTube units: ${bar.youtubeUnits}`}</title>
                      </rect>
                      <rect x={bar.x + bw + 2} y={yBase - bar.groqHeight} width={bw} height={bar.groqHeight} fill="#5fc1ff">
                        <title>{`${bar.label} Groq calls: ${bar.groqCalls}`}</title>
                      </rect>
                      <rect x={bar.x + (bw + 2) * 2} y={yBase - bar.groqClassifiedHeight} width={bw} height={bar.groqClassifiedHeight} fill="#7ce0a3">
                        <title>{`${bar.label} Groq classified: ${bar.groqClassified}`}</title>
                      </rect>
                      <text x={bar.x + ((bw * 3 + 4) / 2)} y={apiUsageGraph.height - 14} textAnchor="middle" fill="rgba(255,255,255,0.62)" style={{ fontSize: 10 }}>
                        {bar.label}
                      </text>
                    </g>
                  );
                })}
              </svg>

              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
                <span className="authMessage" style={{ margin: 0 }}><span style={{ color: "#ff6f43" }}>■</span> YouTube units/day</span>
                <span className="authMessage" style={{ margin: 0 }}><span style={{ color: "#5fc1ff" }}>■</span> Groq calls/day</span>
                <span className="authMessage" style={{ margin: 0 }}><span style={{ color: "#7ce0a3" }}>■</span> Groq classified/day</span>
              </div>
            </div>
          ) : (
            <p className="authMessage">No API usage telemetry yet. Activity appears after YouTube or Groq calls occur.</p>
          )}

          {/* YouTube Quota Backfill */}
          {(() => {
            const DAILY_QUOTA = 10_000;
            const AUTO_TRIGGER_MS = 120_000;
            const BACKFILL_WINDOW_MS = 5 * 60 * 1000;
            const liveMs = msUntilReset ?? quotaStatus?.msUntilReset ?? null;
            const inWindow = liveMs !== null && liveMs <= BACKFILL_WINDOW_MS;
            const willAutoTrigger = liveMs !== null && liveMs <= AUTO_TRIGGER_MS;

            const formatCountdown = (ms: number) => {
              const totalSec = Math.max(0, Math.floor(ms / 1000));
              const h = Math.floor(totalSec / 3600);
              const m = Math.floor((totalSec % 3600) / 60);
              const s = totalSec % 60;
              return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
            };

            const usagePct = quotaStatus ? Math.min(100, Math.round((quotaStatus.todayUsageUnits / DAILY_QUOTA) * 100)) : null;

            return (
              <section className="panel featurePanel" style={{ marginTop: 10, border: inWindow ? "1px solid #ff6f43" : undefined }}>
                <div className="panelHeading">
                  <span>YouTube Quota Backfill</span>
                  {liveMs !== null ? (
                    <strong style={{ color: inWindow ? "#ff6f43" : undefined }}>
                      Reset in {formatCountdown(liveMs)}
                    </strong>
                  ) : null}
                </div>
                <div className="interactiveStack">
                  {quotaStatus ? (
                    <div className="statusMetrics">
                      <div>
                        <strong>Used today</strong>
                        <p style={{ color: usagePct !== null && usagePct >= 90 ? "#ff6f43" : undefined }}>
                          {quotaStatus.todayUsageUnits.toLocaleString()} / {DAILY_QUOTA.toLocaleString()}
                          {usagePct !== null ? ` (${usagePct}%)` : ""}
                        </p>
                      </div>
                      <div>
                        <strong>Remaining</strong>
                        <p>{quotaStatus.remainingUnits.toLocaleString()} units</p>
                      </div>
                      <div>
                        <strong>Backfill budget</strong>
                        <p>{quotaStatus.recommendedBudget.toLocaleString()} units ({Math.floor(quotaStatus.recommendedBudget / 100)} seeds)</p>
                      </div>
                      <div>
                        <strong>Seeds available</strong>
                        <p>{quotaStatus.availableSeedCount.toLocaleString()} videos</p>
                      </div>
                      <div>
                        <strong>Resets at</strong>
                        <p>{new Date(quotaStatus.quotaResetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="authMessage">Loading quota status…</p>
                  )}

                  {willAutoTrigger && !backfillRunning ? (
                    <p className="authMessage" style={{ color: "#ff6f43" }}>
                      ⚡ Auto-backfill will trigger in {liveMs !== null ? formatCountdown(liveMs - AUTO_TRIGGER_MS < 0 ? 0 : liveMs) : "…"}
                    </p>
                  ) : null}

                  {backfillRunning ? (
                    <p className="authMessage">Running backfill… this may take a minute.</p>
                  ) : null}

                  {backfillResult ? (
                    <p className="authMessage" style={{ color: "#7ce0a3" }}>{backfillResult}</p>
                  ) : null}

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => void triggerBackfill(quotaStatus?.recommendedBudget ?? 0)}
                      disabled={backfillRunning || !quotaStatus || quotaStatus.recommendedBudget < 100}
                    >
                      {backfillRunning ? "Running…" : "Run Backfill Now"}
                    </button>
                    <button type="button" onClick={() => void loadQuotaStatus()} disabled={backfillRunning}>
                      Refresh Status
                    </button>
                  </div>

                  <p className="authMessage" style={{ opacity: 0.6 }}>
                    Backfill runs shallow (depth 1) related discovery for catalog videos that have no cached related data.
                    Each seed uses ~100 YouTube API units. Auto-triggers 2 minutes before daily quota reset if ≥500 units remain.
                  </p>
                </div>
              </section>
            );
          })()}
        </div>
      ) : null}

      {activeTab === "categories" ? (
        <section className="panel featurePanel">
          <div className="panelHeading">
            <span>Edit Categories</span>
            <strong>{categories.length} rows</strong>
          </div>
          <div className="interactiveStack">
            {categories.slice(0, 30).map((row) => (
              <div key={row.id} className="authForm">
                <label>
                  <span>Genre</span>
                  <input
                    value={row.genre}
                    onChange={(event) => {
                      const next = categories.map((item) => (item.id === row.id ? { ...item, genre: event.target.value } : item));
                      setCategories(next);
                    }}
                  />
                </label>
                <label>
                  <span>Thumbnail Video ID</span>
                  <input
                    value={row.thumbnailVideoId ?? ""}
                    onChange={(event) => {
                      const next = categories.map((item) => (
                        item.id === row.id ? { ...item, thumbnailVideoId: event.target.value || null } : item
                      ));
                      setCategories(next);
                    }}
                  />
                </label>
                <button type="button" onClick={() => void saveCategory(row)}>Save Category</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "videos" ? (
        <>
          <section className="panel featurePanel">
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button
                type="button"
                className={videoModerationPane === "pending" ? "navLink navLinkActive" : "navLink"}
                onClick={() => setVideoModerationPane("pending")}
              >
                New Videos Pending ({pendingVideoTotal})
              </button>
              <button
                type="button"
                className={videoModerationPane === "recent" ? "navLink navLinkActive" : "navLink"}
                onClick={() => setVideoModerationPane("recent")}
              >
                Recently Approved ({recentlyApprovedVideos.length})
              </button>
            </div>
            <div className="panelHeading">
              {videoModerationPane === "pending" ? (
                null
              ) : (
                <>
                  <span>Recently Approved</span>
                  <strong>last 24 hours · {recentlyApprovedVideos.length} video{recentlyApprovedVideos.length !== 1 ? "s" : ""}</strong>
                </>
              )}
            </div>
            <div className="interactiveStack">
              {videoModerationPane === "pending" ? (
                <>
                  {pendingVideos.length === 0 ? <p className="authMessage">No pending videos.</p> : null}
                  {pendingVideos.length > 0 ? (
                    (() => {
                      const row = pendingVideos[0];
                      const draft = pendingVideoDrafts[row.id];
                      const editableTitle = draft?.title ?? row.title;
                      // If a draft exists for this row (user has edited it), use the draft
                      // value even if parsedArtist/parsedTrack is null (user cleared the field).
                      // Only fall back to the server value when no draft exists yet.
                      const editableArtist = draft !== undefined ? (draft.parsedArtist ?? "") : (row.parsedArtist ?? "");
                      const editableTrack = draft !== undefined ? (draft.parsedTrack ?? "") : (row.parsedTrack ?? "");
                      const baseStartAtSec = row.durationSec && row.durationSec > 0 ? Math.floor(row.durationSec / 2) : 0;
                      const maxStartAtSec = row.durationSec && row.durationSec > 0 ? Math.max(0, row.durationSec - 1) : null;

                      return (
                        <div
                          key={`pending-${row.id}`}
                          className="authForm authFormWide"
                          style={{
                            width: "100%",
                            maxWidth: "none",
                            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                            gap: 14,
                            alignItems: "start",
                          }}
                        >
                          <div style={{ display: "grid", gap: 10 }}>
                            <p className="authMessage" style={{ margin: 0 }}><strong>{row.videoId}</strong></p>
                            <label>
                              <span>Title</span>
                              <input
                                value={editableTitle}
                                onChange={(event) => {
                                  const nextTitle = event.target.value;
                                  setPendingVideoDrafts((current) => ({
                                    ...current,
                                    [row.id]: {
                                      title: nextTitle,
                                      parsedArtist: current[row.id]?.parsedArtist ?? row.parsedArtist,
                                      parsedTrack: current[row.id]?.parsedTrack ?? row.parsedTrack,
                                    },
                                  }));
                                }}
                                placeholder="Video title"
                              />
                            </label>
                            <label>
                              <span>Artist (optional override)</span>
                              <input
                                value={editableArtist}
                                onChange={(event) => {
                                  const nextArtist = event.target.value;
                                  setPendingVideoDrafts((current) => ({
                                    ...current,
                                    [row.id]: {
                                      title: current[row.id]?.title ?? row.title,
                                      parsedArtist: nextArtist || null,
                                      parsedTrack: current[row.id]?.parsedTrack ?? row.parsedTrack,
                                    },
                                  }));
                                }}
                                placeholder="Artist"
                              />
                            </label>
                            <label>
                              <span>Track (optional override)</span>
                              <input
                                value={editableTrack}
                                onChange={(event) => {
                                  const nextTrack = event.target.value;
                                  setPendingVideoDrafts((current) => ({
                                    ...current,
                                    [row.id]: {
                                      title: current[row.id]?.title ?? row.title,
                                      parsedArtist: current[row.id]?.parsedArtist ?? row.parsedArtist,
                                      parsedTrack: nextTrack || null,
                                    },
                                  }));
                                }}
                                placeholder="Track name"
                              />
                            </label>
                            <p className="authMessage" style={{ margin: 0 }}>Channel: {row.channelTitle ?? "-"}</p>
                          </div>
                          <div style={{ display: "grid", gap: 10 }}>
                            <div
                              style={{
                                position: "relative",
                                width: "100%",
                                aspectRatio: "16 / 9",
                                borderRadius: 10,
                                overflow: "hidden",
                                background: "rgba(0,0,0,0.45)",
                                border: "1px solid rgba(255,255,255,0.12)",
                              }}
                            >
                              <iframe
                                ref={pendingPreviewIframeRef}
                                src={`https://www.youtube.com/embed/${encodeURIComponent(row.videoId)}?rel=0&autoplay=1&mute=0&playsinline=1&enablejsapi=1&start=${baseStartAtSec}`}
                                title={`Pending video preview ${row.videoId}`}
                                loading="lazy"
                                onLoad={() => {
                                  pendingPreviewCurrentTimeRef.current = baseStartAtSec;
                                  // Re-seek after load to reliably honour midpoint starts.
                                  window.setTimeout(() => {
                                    seekPendingPreview(baseStartAtSec);
                                  }, 180);
                                }}
                                referrerPolicy="strict-origin-when-cross-origin"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                allowFullScreen
                                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                              />
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button
                                type="button"
                                onClick={() => void moderatePendingVideo(row, "approve")}
                                disabled={moderatingVideoId === row.videoId || editableTitle.trim().length === 0}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => void moderatePendingVideo(row, "remove")}
                                disabled={moderatingVideoId === row.videoId}
                              >
                                Remove
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const knownCurrentTime = pendingPreviewCurrentTimeRef.current;
                                  const safeCurrentTime =
                                    typeof knownCurrentTime === "number" && Number.isFinite(knownCurrentTime)
                                      ? knownCurrentTime
                                      : baseStartAtSec;
                                  const unclampedNextStartAtSec = safeCurrentTime + 20;
                                  const nextStartAtSec = maxStartAtSec === null
                                    ? unclampedNextStartAtSec
                                    : Math.min(unclampedNextStartAtSec, maxStartAtSec);
                                  const appliedOffset = Math.max(0, Math.floor(nextStartAtSec - baseStartAtSec));

                                  setPendingPreviewSkipOffsets((current) => {
                                    return {
                                      ...current,
                                      [row.id]: appliedOffset,
                                    };
                                  });

                                  pendingPreviewCurrentTimeRef.current = nextStartAtSec;
                                  seekPendingPreview(nextStartAtSec);
                                }}
                                disabled={moderatingVideoId === row.videoId}
                              >
                                Skip +20s
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ) : null}
                </>
              ) : (
                <>
                  <p className="authMessage">Approved in the last 24 hours, newest first. Use Revoke to return a video to the pending queue.</p>
                  {recentlyApprovedVideos.length === 0 ? <p className="authMessage">No recently approved videos yet.</p> : null}
                  {recentlyApprovedVideos.map((row) => (
                    <div key={`recent-${row.id}`} className="authForm">
                      <div
                        style={{
                          position: "relative",
                          width: "100%",
                          maxWidth: 480,
                          aspectRatio: "16 / 9",
                          borderRadius: 10,
                          overflow: "hidden",
                          background: "rgba(0,0,0,0.45)",
                          border: "1px solid rgba(255,255,255,0.12)",
                        }}
                      >
                        <iframe
                          src={`https://www.youtube.com/embed/${encodeURIComponent(row.videoId)}?rel=0`}
                          title={`Recently approved video preview ${row.videoId}`}
                          loading="lazy"
                          referrerPolicy="strict-origin-when-cross-origin"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          allowFullScreen
                          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                        />
                      </div>
                      <p className="authMessage"><strong>{row.videoId}</strong></p>
                      <p className="authMessage">{row.title}</p>
                      {row.parsedArtist ? <p className="authMessage">Artist: {row.parsedArtist}</p> : null}
                      {row.parsedTrack ? <p className="authMessage">Track: {row.parsedTrack}</p> : null}
                      {row.channelTitle ? <p className="authMessage">Channel: {row.channelTitle}</p> : null}
                      {row.updatedAt ? <p className="authMessage">Approved: {new Date(row.updatedAt).toLocaleTimeString()}</p> : null}
                      <button
                        type="button"
                        onClick={() => void revokeApprovedVideo(row.videoId)}
                        disabled={revokingVideoId === row.videoId}
                      >
                        {revokingVideoId === row.videoId ? "Revoking…" : "Revoke Approval"}
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </section>
        </>
      ) : null}

      {activeTab === "catalog-review" ? (
        <section className="panel featurePanel">
          <div className="panelHeading">
            <span>Catalog Cleanup Queue</span>
            <strong>{catalogReviewRemaining} remaining</strong>
          </div>
          <div className="interactiveStack">
            <p className="authMessage" style={{ margin: 0 }}>
              Review each catalog video one-by-one. Keep removes it from this queue only. Remove hard-deletes it everywhere.
            </p>
            {!catalogReviewCurrentVideo ? (
              <p className="authMessage">All queued videos are judged.</p>
            ) : (
              (() => {
                const row = catalogReviewCurrentVideo;
                const baseStartAtSec = row.durationSec && row.durationSec > 0 ? Math.floor(row.durationSec / 2) : 0;
                const maxStartAtSec = row.durationSec && row.durationSec > 0 ? Math.max(0, row.durationSec - 1) : null;

                return (
                  <div
                    className="authForm authFormWide"
                    style={{
                      width: "100%",
                      maxWidth: "none",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: 14,
                      alignItems: "start",
                    }}
                  >
                    <div style={{ display: "grid", gap: 8 }}>
                      <p className="authMessage" style={{ margin: 0 }}><strong>{row.videoId}</strong></p>
                      <p className="authMessage" style={{ margin: 0 }}>{row.title}</p>
                      {row.parsedArtist ? <p className="authMessage" style={{ margin: 0 }}>Artist: {row.parsedArtist}</p> : null}
                      {row.parsedTrack ? <p className="authMessage" style={{ margin: 0 }}>Track: {row.parsedTrack}</p> : null}
                      {row.channelTitle ? <p className="authMessage" style={{ margin: 0 }}>Channel: {row.channelTitle}</p> : null}
                      {row.enqueuedAt ? (
                        <p className="authMessage" style={{ margin: 0 }}>
                          Queued: {new Date(row.enqueuedAt).toLocaleString()}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void refreshCatalogReviewMetadata()}
                        disabled={catalogReviewActionVideoId === row.videoId}
                      >
                        Refresh Metadata
                      </button>
                    </div>

                    <div style={{ display: "grid", gap: 10 }}>
                      <div
                        style={{
                          position: "relative",
                          width: "100%",
                          aspectRatio: "16 / 9",
                          borderRadius: 10,
                          overflow: "hidden",
                          background: "rgba(0,0,0,0.45)",
                          border: "1px solid rgba(255,255,255,0.12)",
                        }}
                      >
                        <iframe
                          ref={catalogReviewPreviewIframeRef}
                          src={`https://www.youtube.com/embed/${encodeURIComponent(row.videoId)}?rel=0&autoplay=1&mute=0&playsinline=1&enablejsapi=1&start=${baseStartAtSec}`}
                          title={`Catalog review preview ${row.videoId}`}
                          loading="lazy"
                          onLoad={() => {
                            catalogReviewPreviewCurrentTimeRef.current = baseStartAtSec;
                            window.setTimeout(() => {
                              seekCatalogReviewPreview(baseStartAtSec);
                            }, 180);
                          }}
                          referrerPolicy="strict-origin-when-cross-origin"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          allowFullScreen
                          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                        />
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => void moderateCatalogReviewVideo("approve")}
                          disabled={catalogReviewActionVideoId === row.videoId}
                        >
                          Keep Video
                        </button>
                        <button
                          type="button"
                          onClick={() => void moderateCatalogReviewVideo("remove")}
                          disabled={catalogReviewActionVideoId === row.videoId}
                        >
                          Remove Video
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const knownCurrentTime = catalogReviewPreviewCurrentTimeRef.current;
                            const safeCurrentTime =
                              typeof knownCurrentTime === "number" && Number.isFinite(knownCurrentTime)
                                ? knownCurrentTime
                                : baseStartAtSec;
                            const unclampedNextStartAtSec = safeCurrentTime + 20;
                            const nextStartAtSec = maxStartAtSec === null
                              ? unclampedNextStartAtSec
                              : Math.min(unclampedNextStartAtSec, maxStartAtSec);

                            catalogReviewPreviewCurrentTimeRef.current = nextStartAtSec;
                            seekCatalogReviewPreview(nextStartAtSec);
                          }}
                          disabled={catalogReviewActionVideoId === row.videoId}
                        >
                          Skip +20s
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        </section>
      ) : null}

    </div>
  );
}
