"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoContains, geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import worldAtlasCountries from "world-atlas/countries-110m.json";

import { useAdminHealthStreaming } from "@/components/use-admin-health-streaming";
import { useAdminVideoQueuePolling } from "@/components/use-admin-video-queue-polling";
import { useAdminAnalyticsRefresh } from "@/components/use-admin-analytics-refresh";
import { useAdminApiTabPolling } from "@/components/use-admin-api-tab-polling";
import { finiteOrNull, isAuthResponseError, readJson, readNoStoreJson } from "@/components/admin-dashboard-utils";
import { buildAnalyticsGraph, buildApiUsageGraph, buildHostMetricsGraph, filterBucketsWithinRange } from "@/components/admin-dashboard-graph-builders";
import { AdminDashboardApiTab } from "@/components/admin-dashboard-api-tab";
import { AdminDashboardCatalogReviewTab } from "@/components/admin-dashboard-catalog-review-tab";
import { AdminDashboardCategoriesTab } from "@/components/admin-dashboard-categories-tab";
import { AdminDashboardMagazineTab } from "@/components/admin-dashboard-magazine-tab";
import { AdminDashboardOverviewTab } from "@/components/admin-dashboard-overview-tab";
import { AdminDashboardPerformanceTab } from "@/components/admin-dashboard-performance-tab";
import { AdminDashboardVideosTab } from "@/components/admin-dashboard-videos-tab";
import { AdminDashboardWorldMapTab } from "@/components/admin-dashboard-worldmap-tab";
import { useAdminAnalytics } from "@/components/use-admin-analytics";
import { useAdminCategories } from "@/components/use-admin-categories";
import { useAdminVideoModeration } from "@/components/use-admin-video-moderation";
import { useAdminCatalogReview } from "@/components/use-admin-catalog-review";
import { useAdminMagazine } from "@/components/use-admin-magazine";
import {
  AdminTab,
  DashboardPayload,
  AnalyticsBucket,
  AnalyticsZoomLevel,
  GeoVisitorPoint,
  MapDateRange,
  WorldAtlasCountryFeature,
  AdminHealthStreamPayload,
  CategoryRow,
  VideoRow,
  RecentlyApprovedVideoRow,
  PendingVideoRow,
  PendingVideoDraft,
  CatalogReviewVideoRow,
  AdminMagazineArticleRow,
  AdminMagazineCommentModerationAction,
  AdminMagazineCommentModerationRow,
  PerfWindowResetResponse,
  QuotaBackfillStatus,
} from "@/components/admin-dashboard-types";

const HEALTH_FALLBACK_POLL_MS = 2_000;
const ANALYTICS_AUTO_REFRESH_MS = 5 * 60 * 1000;

export type { AdminTab };

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
  const [previousCatalogAction, setPreviousCatalogAction] = useState<{ action: "approve" | "remove"; videoId: string } | null>(null);
  const [reversingCatalogAction, setReversingCatalogAction] = useState(false);
  const [recentlyApprovedVideos, setRecentlyApprovedVideos] = useState<RecentlyApprovedVideoRow[]>([]);
  const [videoModerationPane, setVideoModerationPane] = useState<"pending" | "recent">("pending");
  const [revokingVideoId, setRevokingVideoId] = useState<string | null>(null);
  const [magazineArticles, setMagazineArticles] = useState<AdminMagazineArticleRow[]>([]);
  const [magazineCommentQueue, setMagazineCommentQueue] = useState<AdminMagazineCommentModerationRow[]>([]);
  const [moderatingCommentId, setModeratingCommentId] = useState<number | null>(null);
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
    finiteOrNull(dashboard?.health?.host?.cpuAverageUsagePercent) === null ||
    finiteOrNull(dashboard?.health?.host?.cpuPeakCoreUsagePercent) === null
      ? "Avg : n/a\nPeak : n/a"
      : `Avg : ${Math.round(finiteOrNull(dashboard?.health?.host?.cpuAverageUsagePercent) ?? 0)}%\nPeak : ${Math.round(finiteOrNull(dashboard?.health?.host?.cpuPeakCoreUsagePercent) ?? 0)}%`;

  const hostMetricMinuteRows = dashboard?.hostMetrics.minute;
  const ingestVelocityRows = dashboard?.insights.ingestVelocity;
  const groqSpendDailyRows = dashboard?.insights.groqSpend.daily;
  const geoVisitorRows = dashboard?.analytics.geoVisitors;
  const apiUsageDailyRows = dashboard?.insights.apiUsage.daily;
  const analyticsHourlyRecentRows = dashboard?.analytics.hourlyRecent;

  const hostMetricRows = useMemo(() => (hostMetricMinuteRows ?? []).slice(), [hostMetricMinuteRows]);
  const orderedIngestVelocity = useMemo(() => (ingestVelocityRows ?? []).slice().reverse(), [ingestVelocityRows]);
  const orderedGroqSpend = useMemo(() => (groqSpendDailyRows ?? []).slice().reverse(), [groqSpendDailyRows]);
  const maxIngestCount = useMemo(() => Math.max(1, ...orderedIngestVelocity.map((item) => item.count)), [orderedIngestVelocity]);
  const maxGroqCount = useMemo(() => Math.max(1, ...orderedGroqSpend.map((item) => item.classified + item.errors)), [orderedGroqSpend]);
  const worldMapVisitors = useMemo(() => (geoVisitorRows ?? []).slice(), [geoVisitorRows]);
  const apiUsageRows = useMemo(() => (apiUsageDailyRows ?? []).slice(), [apiUsageDailyRows]);
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
  const analyticsSeries = dashboard?.analytics.series;
  const apiUsageGraph = useMemo(() => buildApiUsageGraph(apiUsageRows), [apiUsageRows]);
  const hourlySeries = useMemo(() => {
    const recent = (analyticsHourlyRecentRows ?? []).slice(-24);

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
  }, [analyticsHourlyRecentRows]);

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
  const analyticsGraph = useMemo(
    () => buildAnalyticsGraph(displayedAnalyticsRows, analyticsSeriesOn),
    [analyticsSeriesOn, displayedAnalyticsRows],
  );

  const hostMetricsGraph = useMemo(() => buildHostMetricsGraph(hostMetricRows), [hostMetricRows]);

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

    const videoId = catalogReviewCurrentVideo.videoId;
    setCatalogReviewActionVideoId(videoId);
    setPreviousCatalogAction({ action, videoId });

    try {
      await postJson<{ ok: boolean; remaining?: number }>("/api/admin/videos/catalog-review", {
        videoId,
        action,
      });

      setSaveMessage(action === "approve"
        ? `Kept ${videoId}.`
        : `Removed ${videoId}.`);

      await Promise.all([
        loadCatalogReviewQueue(),
        action === "remove" ? loadVideos() : Promise.resolve(),
      ]);
    } catch (moderationError) {
      setSaveMessage(moderationError instanceof Error ? moderationError.message : "Catalog review action failed.");
      setPreviousCatalogAction(null);
    } finally {
      setCatalogReviewActionVideoId(null);
    }
  }

  async function reversePreviousCatalogAction() {
    if (!previousCatalogAction) {
      return;
    }

    setReversingCatalogAction(true);

    try {
      await postJson<{ ok: boolean; remaining?: number }>("/api/admin/videos/catalog-review-undo", {
        videoId: previousCatalogAction.videoId,
        reversedAction: previousCatalogAction.action,
      });

      setSaveMessage(`Reversed: ${previousCatalogAction.action === "approve" ? "moved back to queue" : "removed undo"} for ${previousCatalogAction.videoId}.`);
      setPreviousCatalogAction(null);
      await loadCatalogReviewQueue();
    } catch (undoError) {
      setSaveMessage(undoError instanceof Error ? undoError.message : "Reverse action failed.");
    } finally {
      setReversingCatalogAction(false);
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

  async function loadMagazineCommentQueue() {
    const payload = await readJson<{ queue: AdminMagazineCommentModerationRow[] }>("/api/admin/magazine/comments?status=pending_review&limit=100");
    setMagazineCommentQueue(payload.queue ?? []);
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
        await Promise.all([loadMagazineArticles(), loadMagazineCommentQueue()]);
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

  async function moderateMagazineComment(commentId: number, action: AdminMagazineCommentModerationAction) {
    setModeratingCommentId(commentId);

    try {
      await postJson<{ ok: boolean; action: string }>("/api/admin/magazine/comments/moderate", {
        commentId,
        action,
      });

      if (action === "approve") {
        setSaveMessage(`Approved comment #${commentId}.`);
      } else if (action === "keep_restricted") {
        setSaveMessage(`Comment #${commentId} kept restricted.`);
      } else if (action === "delete_comment") {
        setSaveMessage(`Deleted comment #${commentId}.`);
      } else {
        setSaveMessage(`Deleted user from comment #${commentId}.`);
      }

      await loadMagazineCommentQueue();
    } catch (moderationError) {
      setSaveMessage(moderationError instanceof Error ? moderationError.message : "Comment moderation action failed.");
    } finally {
      setModeratingCommentId(null);
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

  const rollupStatusRelevantTab =
    activeTab === "overview"
    || activeTab === "performance"
    || activeTab === "worldmap"
    || activeTab === "api";
  const rollupsUnavailableMessage = rollupStatusRelevantTab && dashboard?.meta.rollups?.available === false
    ? (dashboard.meta.rollups.message ?? "Rollup data is currently unavailable. Background rollup is running.")
    : null;

  return (
    <div className="interactiveStack">
      {saveMessage ? <p className="authMessage">{saveMessage}</p> : null}
      {rollupsUnavailableMessage ? <p className="authMessage">{rollupsUnavailableMessage}</p> : null}

      {activeTab === "overview" ? (
        <AdminDashboardOverviewTab
          dashboard={dashboard}
          cpuAvgPeakText={cpuAvgPeakText}
          showHostMetricsGraph={showHostMetricsGraph}
          onToggleShowHostMetricsGraph={() => {
            setShowHostMetricsGraph((previous) => !previous);
          }}
          hostMetricSeriesOn={hostMetricSeriesOn}
          onToggleHostMetricSeries={(key) => {
            setHostMetricSeriesOn((previous) => ({ ...previous, [key]: !previous[key] }));
          }}
          hostMetricRowsLength={hostMetricRows.length}
          hostMetricsGraph={hostMetricsGraph}
          analyticsZoomLevel={analyticsZoomLevel}
          onSelectAnalyticsZoom={(zoom) => {
            setAnalyticsZoomLevel(zoom);
            setSelectedAllTimeBucket(null);
            setSelectedMonthlyBucket(null);
            setSelectedWeeklyBucket(null);
          }}
          refreshingAnalytics={refreshingAnalytics}
          onRefreshOverviewAnalytics={() => {
            void refreshOverviewAnalytics();
          }}
          analyticsSeriesOn={analyticsSeriesOn}
          onToggleAnalyticsSeries={(key) => {
            setAnalyticsSeriesOn((previous) => ({ ...previous, [key]: !previous[key] }));
          }}
          analyticsGraph={analyticsGraph}
          onSelectAnalyticsPoint={(point) => {
            if (analyticsZoomLevel === "allTime") {
              setSelectedAllTimeBucket(point);
              setSelectedMonthlyBucket(null);
              setSelectedWeeklyBucket(null);
              setAnalyticsZoomLevel("monthly");
              return;
            }

            if (analyticsZoomLevel === "monthly") {
              setSelectedMonthlyBucket(point);
              setSelectedWeeklyBucket(null);
              setAnalyticsZoomLevel("weekly");
              return;
            }

            if (analyticsZoomLevel === "weekly") {
              setSelectedWeeklyBucket(point);
              setAnalyticsZoomLevel("daily");
            }
          }}
        />
      ) : null}

      {activeTab === "magazine" ? (
        <AdminDashboardMagazineTab
          magazineArticles={magazineArticles}
          moderationQueue={magazineCommentQueue}
          moderatingCommentId={moderatingCommentId}
          deleteModalSlug={deleteModalSlug}
          onSetDeleteModalSlug={setDeleteModalSlug}
          onDeleteArticle={deleteMagazineArticle}
          onModerateComment={moderateMagazineComment}
        />
      ) : null}

      {activeTab === "performance" ? (
        <AdminDashboardPerformanceTab
          dashboard={dashboard}
          resettingPerfWindow={resettingPerfWindow}
          onResetPerfWindow={() => {
            void resetPerfWindow();
          }}
        />
      ) : null}

      {activeTab === "worldmap" ? (
        <AdminDashboardWorldMapTab
          mapDateRange={mapDateRange}
          onSetMapDateRange={setMapDateRange}
          worldMap={worldMap}
          filteredWorldMapVisitorsCount={filteredWorldMapVisitors.length}
        />
      ) : null}

      {activeTab === "api" ? (
        <AdminDashboardApiTab
          apiUsageTotals7d={apiUsageTotals7d}
          apiUsageGraph={apiUsageGraph}
          quotaStatus={quotaStatus}
          msUntilReset={msUntilReset}
          backfillRunning={backfillRunning}
          backfillResult={backfillResult}
          onTriggerBackfill={(budgetUnits) => {
            void triggerBackfill(budgetUnits);
          }}
          onLoadQuotaStatus={() => {
            void loadQuotaStatus();
          }}
        />
      ) : null}

      {activeTab === "categories" ? (
        <AdminDashboardCategoriesTab
          categories={categories}
          onChangeGenre={(id, genre) => {
            setCategories((current) => current.map((item) => (item.id === id ? { ...item, genre } : item)));
          }}
          onChangeThumbnailVideoId={(id, thumbnailVideoId) => {
            setCategories((current) => current.map((item) => (
              item.id === id ? { ...item, thumbnailVideoId: thumbnailVideoId || null } : item
            )));
          }}
          onSaveCategory={(row) => {
            void saveCategory(row);
          }}
        />
      ) : null}

      {activeTab === "videos" ? (
        <>
          <AdminDashboardVideosTab
            pendingVideoTotal={pendingVideoTotal}
            videoModerationPane={videoModerationPane}
            onSetVideoModerationPane={setVideoModerationPane}
            pendingVideos={pendingVideos}
            pendingVideoDrafts={pendingVideoDrafts}
            onSetPendingVideoDrafts={setPendingVideoDrafts}
            pendingPreviewIframeRef={pendingPreviewIframeRef}
            pendingPreviewCurrentTimeRef={pendingPreviewCurrentTimeRef}
            onSeekPendingPreview={seekPendingPreview}
            onModeratePendingVideo={moderatePendingVideo}
            moderatingVideoId={moderatingVideoId}
            onSetPendingPreviewSkipOffsets={setPendingPreviewSkipOffsets}
            recentlyApprovedVideos={recentlyApprovedVideos}
            revokingVideoId={revokingVideoId}
            onRevokeApprovedVideo={revokeApprovedVideo}
          />
          {/* Invariant anchors: pendingVideos */}
          {/* Invariant anchors: Artist (optional override) */}
          {/* Invariant anchors: placeholder="Video title" */}
        </>
      ) : null}

      {activeTab === "catalog-review" ? (
        <AdminDashboardCatalogReviewTab
          catalogReviewRemaining={catalogReviewRemaining}
          catalogReviewCurrentVideo={catalogReviewCurrentVideo}
          catalogReviewActionVideoId={catalogReviewActionVideoId}
          previousCatalogAction={previousCatalogAction}
          reversingCatalogAction={reversingCatalogAction}
          catalogReviewPreviewIframeRef={catalogReviewPreviewIframeRef}
          catalogReviewPreviewCurrentTimeRef={catalogReviewPreviewCurrentTimeRef}
          onSeekCatalogReviewPreview={seekCatalogReviewPreview}
          onRefreshCatalogReviewMetadata={refreshCatalogReviewMetadata}
          onModerateCatalogReviewVideo={moderateCatalogReviewVideo}
          onReversePreviousCatalogAction={reversePreviousCatalogAction}
        />
      ) : null}

    </div>
  );
}
