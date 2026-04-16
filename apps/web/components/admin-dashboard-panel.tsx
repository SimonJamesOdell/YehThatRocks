"use client";

import { useEffect, useMemo, useState } from "react";

const HEALTH_FALLBACK_POLL_MS = 2_000;

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
  authEvents: number;
};

type AnalyticsZoomLevel = "allTime" | "monthly" | "weekly" | "daily" | "hourly";

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
  counts: { users: number; videos: number; artists: number; categories: number };
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
type ArtistRow = {
  id: number;
  name: string;
  country: string | null;
  genre1: string | null;
  genre2: string | null;
  genre3: string | null;
  genre4: string | null;
  genre5: string | null;
  genre6: string | null;
};

type AmbiguousVideoRow = {
  id: number;
  videoId: string;
  title: string;
  description: string | null;
  parsedArtist: string | null;
  parsedTrack: string | null;
  parsedVideoType: string | null;
  parseConfidence: number | null;
  parseMethod: string | null;
  parseReason: string | null;
  channelTitle: string | null;
  updatedAt: string | null;
};

export type AdminTab = "overview" | "categories" | "videos" | "artists" | "ambiguous";

async function readJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);

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
  const [artists, setArtists] = useState<ArtistRow[]>([]);
  const [ambiguousVideos, setAmbiguousVideos] = useState<AmbiguousVideoRow[]>([]);

  const [videoQuery, setVideoQuery] = useState("");
  const [videoImportSource, setVideoImportSource] = useState("");
  const [ingestingVideo, setIngestingVideo] = useState(false);
  const [artistQuery, setArtistQuery] = useState("");
  const [ambiguousQuery, setAmbiguousQuery] = useState("");
  const [moderatingVideoId, setModeratingVideoId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [refreshingAnalytics, setRefreshingAnalytics] = useState(false);
  const [analyticsZoomLevel, setAnalyticsZoomLevel] = useState<AnalyticsZoomLevel>("daily");
  const [selectedAllTimeBucket, setSelectedAllTimeBucket] = useState<AnalyticsBucket | null>(null);
  const [selectedMonthlyBucket, setSelectedMonthlyBucket] = useState<AnalyticsBucket | null>(null);
  const [selectedWeeklyBucket, setSelectedWeeklyBucket] = useState<AnalyticsBucket | null>(null);
  const [showHostMetricsGraph, setShowHostMetricsGraph] = useState(false);
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
  const filterBucketsWithinRange = (rows: AnalyticsBucket[], range: AnalyticsBucket | null) => {
    if (!range) {
      return rows;
    }

    const filtered = rows.filter((row) => row.bucketStart >= range.bucketStart && row.bucketEnd <= range.bucketEnd);
    return filtered.length > 0 ? filtered : rows;
  };

  const analyticsSeries = dashboard?.analytics.series;
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

  const [analyticsSeriesOn, setAnalyticsSeriesOn] = useState({ pageViews: true, videoViews: true, visitors: true, returnVisits: true, authEvents: true });
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
        authEventsPath: "",
        yTicks: [],
        xTicks: [],
        points: [],
        axis: { paddingLeft, paddingRight, paddingTop, paddingBottom },
      };
    }

    const enabledSeriesMaxPerDay = (row: { pageViews: number; videoViews: number; uniqueVisitors: number; returnVisits: number; authEvents: number }) => Math.max(
      analyticsSeriesOn.pageViews ? row.pageViews : 0,
      analyticsSeriesOn.videoViews ? row.videoViews : 0,
      analyticsSeriesOn.visitors ? row.uniqueVisitors : 0,
      analyticsSeriesOn.returnVisits ? row.returnVisits : 0,
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
        yAuthEvents: paddingTop + chartHeight - (item.authEvents / maxVal) * chartHeight,
        bucketStart: item.bucketStart,
        bucketEnd: item.bucketEnd,
        label: item.label,
        pageViews: item.pageViews,
        videoViews: item.videoViews,
        uniqueVisitors: item.uniqueVisitors,
        returnVisits: item.returnVisits,
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
      authEventsPath: makePath(points.map((p) => p.yAuthEvents)),
    };
  }, [analyticsSeriesOn, displayedAnalyticsRows]);

  const hostMetricsGraph = useMemo(() => {
    const width = 680;
    const height = 220;
    const paddingLeft = 46;
    const paddingRight = 20;
    const paddingTop = 14;
    const paddingBottom = 38;

    if (hostMetricRows.length === 0) {
      return {
        width,
        height,
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
      cpuPath: makePath(points.map((point) => point.cpu)),
      memoryPath: makePath(points.map((point) => point.memory)),
      swapPath: makePath(points.map((point) => point.swap)),
      diskPath: makePath(points.map((point) => point.disk)),
      networkPath: makePath(points.map((point) => point.network)),
      xTicks,
      yTicks,
    };
  }, [hostMetricRows]);

  async function loadOverview(forceRefresh = false) {
    const query = forceRefresh ? `?refresh=1&t=${Date.now()}` : "";
    const url = `/api/admin/dashboard${query}`;
    const dashboardPayload = forceRefresh
      ? await readNoStoreJson<DashboardPayload>(url)
      : await readJson<DashboardPayload>(url);
    setDashboard(dashboardPayload);
  }

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

  async function loadArtists() {
    const artistPayload = await readJson<{ artists: ArtistRow[] }>(
      `/api/admin/artists${artistQuery ? `?q=${encodeURIComponent(artistQuery)}` : ""}`,
    );
    setArtists(artistPayload.artists);
  }

  async function loadAmbiguousVideos() {
    const ambiguousPayload = await readJson<{ ambiguousVideos: AmbiguousVideoRow[] }>(
      `/api/admin/videos/ambiguous${ambiguousQuery ? `?q=${encodeURIComponent(ambiguousQuery)}` : ""}`,
    );
    setAmbiguousVideos(ambiguousPayload.ambiguousVideos);
  }

  async function loadActiveTab() {
    setLoading(true);
    setError(null);

    try {
      if (activeTab === "overview") {
        await loadOverview();
      } else if (activeTab === "categories") {
        await loadCategories();
      } else if (activeTab === "videos") {
        await loadVideos();
      } else if (activeTab === "artists") {
        await loadArtists();
      } else if (activeTab === "ambiguous") {
        await loadAmbiguousVideos();
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
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "overview") {
      return;
    }

    let cancelled = false;
    let lastStreamMessageAt = 0;

    const applyHealthPayload = (payload: AdminHealthStreamPayload) => {
      if (!payload?.health) {
        return;
      }

      const sanitizedHost = {
        ...payload.health.host,
        cpuUsagePercent: finiteOrNull(payload.health.host.cpuUsagePercent),
        cpuAverageUsagePercent: finiteOrNull(payload.health.host.cpuAverageUsagePercent),
        cpuPeakCoreUsagePercent: finiteOrNull(payload.health.host.cpuPeakCoreUsagePercent),
        memoryUsagePercent: finiteOrNull(payload.health.host.memoryUsagePercent) ?? 0,
        diskUsagePercent: finiteOrNull(payload.health.host.diskUsagePercent),
        swapUsagePercent: finiteOrNull(payload.health.host.swapUsagePercent),
        networkUsagePercent: finiteOrNull(payload.health.host.networkUsagePercent),
      };

      setDashboard((previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          health: {
            ...payload.health,
            host: sanitizedHost,
          },
          meta: {
            ...previous.meta,
            generatedAt: payload.meta?.generatedAt ?? previous.meta.generatedAt,
          },
        };
      });
    };

    const refreshHealth = async () => {
      try {
        const payload = await readNoStoreJson<AdminHealthStreamPayload>("/api/admin/dashboard/health");
        if (cancelled) {
          return;
        }
        applyHealthPayload(payload);
      } catch {
        // Ignore polling failures and keep the last known state.
      }
    };

    const stream = new EventSource("/api/admin/dashboard/stream");

    stream.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as AdminHealthStreamPayload;
        if (!payload?.health || cancelled) {
          return;
        }

        lastStreamMessageAt = Date.now();
        applyHealthPayload(payload);
      } catch {
        // Ignore malformed payloads.
      }
    };

    stream.onerror = () => {
      void refreshHealth();
    };

    void refreshHealth();

    const pollingTimer = window.setInterval(() => {
      if (Date.now() - lastStreamMessageAt > HEALTH_FALLBACK_POLL_MS * 2) {
        void refreshHealth();
      }
    }, HEALTH_FALLBACK_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(pollingTimer);
      stream.close();
    };
  }, [activeTab]);

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
      await loadVideos();
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
      await loadVideos();
    } catch (importError) {
      setSaveMessage(importError instanceof Error ? importError.message : "Video import failed.");
    } finally {
      setIngestingVideo(false);
    }
  }

  async function saveArtist(row: ArtistRow) {
    try {
      await patchJson("/api/admin/artists", row);
      setSaveMessage(`Saved artist ${row.name}.`);
      await loadArtists();
    } catch (saveError) {
      setSaveMessage(saveError instanceof Error ? saveError.message : "Artist save failed.");
    }
  }

  async function moderateAmbiguousVideo(videoId: string, action: "keep" | "delete") {
    setModeratingVideoId(videoId);

    try {
      await postJson<{ ok: boolean }>("/api/admin/videos/ambiguous", { videoId, action });
      setSaveMessage(action === "delete" ? `Deleted ${videoId}.` : `Kept ${videoId}.`);
      await loadAmbiguousVideos();
    } catch (moderationError) {
      setSaveMessage(moderationError instanceof Error ? moderationError.message : "Moderation action failed.");
    } finally {
      setModeratingVideoId(null);
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
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 11, opacity: 0.5, letterSpacing: "0.06em", textTransform: "uppercase" }}>Host health · live dials + 24h history</span>
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
          <div className="adminOverviewHealthLayout">
            <div className="adminOverviewDials">
              <Dial label="Memory" value={dashboard?.health.host.memoryUsagePercent ?? null} color="#ffc14d" />
              <Dial label="Swap" value={dashboard?.health.host.swapUsagePercent ?? null} color="#f5d96b" />
              <Dial label="CPU" value={finiteOrNull(dashboard?.health.host.cpuUsagePercent)} color="#ff6f43" detail={cpuAvgPeakText} />
              <Dial label="Disk" value={dashboard?.health.host.diskUsagePercent ?? null} color="#7ce0a3" />
              <Dial label="Network" value={dashboard?.health.host.networkUsagePercent ?? null} color="#5fc1ff" />
            </div>
            <div className="statusMetrics">
              <div><strong>Users</strong><p>{dashboard?.counts.users ?? 0}</p></div>
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
                style={{ width: "100%", height: "auto", borderRadius: 10, background: "rgba(255,255,255,0.04)" }}
              >
                {hostMetricRows.length === 0 ? (
                  <text x="340" y="110" textAnchor="middle" fill="rgba(255,255,255,0.2)" style={{ fontSize: 13 }}>Collecting host metric history...</text>
                ) : (
                  <>
                    {hostMetricsGraph.yTicks.map((tick) => (
                      <g key={`hy-${tick.value}-${tick.y.toFixed(1)}`}>
                        <line x1="46" y1={String(tick.y)} x2="660" y2={String(tick.y)} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
                        <text x="40" y={String(tick.y + 3)} textAnchor="end" fill="rgba(255,255,255,0.78)" style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}>{tick.value}%</text>
                      </g>
                    ))}
                    {hostMetricsGraph.xTicks.map((tick) => (
                      <g key={`hx-${tick.label}-${tick.x.toFixed(1)}`}>
                        <line x1={String(tick.x)} y1="14" x2={String(tick.x)} y2="182" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                        <text x={String(tick.x)} y="208" textAnchor="middle" fill="rgba(255,255,255,0.78)" style={{ fontSize: 10 }}>{tick.label}</text>
                      </g>
                    ))}
                    <line x1="46" y1="14" x2="46" y2="182" stroke="rgba(255,255,255,0.24)" strokeWidth="1" />
                    <line x1="46" y1="182" x2="660" y2="182" stroke="rgba(255,255,255,0.24)" strokeWidth="1" />
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
                      ? "User analytics · rolling daily buckets"
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
                onClick={async () => {
                  setRefreshingAnalytics(true);
                  try {
                    await loadOverview(true);
                  } finally {
                    setRefreshingAnalytics(false);
                  }
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
                    ? "Use the Hourly button above to zoom in further."
                    : "Showing the latest 24 hourly buckets."}
          </p>

          <svg
            viewBox={analyticsGraph.points.length > 0 ? `0 0 ${analyticsGraph.width} ${analyticsGraph.height}` : "0 0 680 250"}
            role="img"
            aria-label="Analytics chart — page views, video views, unique visitors, return visits, auth events"
            style={{ width: "100%", height: "auto", borderRadius: 10, background: "rgba(255,255,255,0.04)" }}
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
                    <text x={String(tick.x)} y={String(analyticsGraph.height - 12)} textAnchor="end" fill="rgba(255,255,255,0.78)" transform={`rotate(-45 ${tick.x} ${analyticsGraph.height - 12})`} style={{ fontSize: 10 }}>{tick.label}</text>
                  </g>
                ))}
                <line x1={String(analyticsGraph.axis.paddingLeft)} y1={String(analyticsGraph.axis.paddingTop)} x2={String(analyticsGraph.axis.paddingLeft)} y2={String(analyticsGraph.height - analyticsGraph.axis.paddingBottom)} stroke="rgba(255,255,255,0.24)" strokeWidth="1" />
                <line x1={String(analyticsGraph.axis.paddingLeft)} y1={String(analyticsGraph.height - analyticsGraph.axis.paddingBottom)} x2={String(analyticsGraph.width - analyticsGraph.axis.paddingRight)} y2={String(analyticsGraph.height - analyticsGraph.axis.paddingBottom)} stroke="rgba(255,255,255,0.24)" strokeWidth="1" />
                {analyticsSeriesOn.pageViews && <path d={analyticsGraph.pageViewsPath} fill="none" stroke="#ff9d5c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
                {analyticsSeriesOn.videoViews && <path d={analyticsGraph.videoViewsPath} fill="none" stroke="#5fc1ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
                {analyticsSeriesOn.visitors && <path d={analyticsGraph.visitorsPath} fill="none" stroke="#7ce0a3" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
                {analyticsSeriesOn.returnVisits && <path d={analyticsGraph.returnVisitsPath} fill="none" stroke="#9e86ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
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
                    {analyticsSeriesOn.authEvents && <circle cx={point.x} cy={point.yAuthEvents} r="3.5" fill="#ffd1c4" />}
                    <title>{`${point.label} (${new Date(point.bucketStart).toLocaleString()} - ${new Date(point.bucketEnd).toLocaleString()}) — Page views: ${point.pageViews}, Video views: ${point.videoViews}, Visitors: ${point.uniqueVisitors}, Return visits: ${point.returnVisits}, Auth events: ${point.authEvents}`}</title>
                  </g>
                ))}
              </>
            )}
          </svg>

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
            <div className="panelHeading">
              <span>Catalog Quality</span>
              <strong>Metadata health</strong>
            </div>
            <div className="statusMetrics">
              <div><strong>Playable</strong><p>{dashboard?.insights.metadataQuality.availableVideos ?? 0}</p></div>
              <div><strong>Check Failed</strong><p>{dashboard?.insights.metadataQuality.checkFailedEntries ?? 0}</p></div>
              <div><strong>Missing Meta</strong><p>{dashboard?.insights.metadataQuality.missingMetadata ?? 0}</p></div>
              <div><strong>Low Confidence</strong><p>{dashboard?.insights.metadataQuality.lowConfidence ?? 0}</p></div>
              <div><strong>Unknown Type</strong><p>{dashboard?.insights.metadataQuality.unknownType ?? 0}</p></div>
            </div>
          </section>

          <section className="panel featurePanel">
            <div className="panelHeading">
              <span>Ingestion Velocity</span>
              <strong>Videos added (14d)</strong>
            </div>
            <div className="interactiveStack">
              {orderedIngestVelocity.length > 0 ? orderedIngestVelocity.map((item) => (
                <div key={item.day}>
                  <p className="authMessage">{item.day}: {item.count}</p>
                  <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 8, height: 10, overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${Math.max(3, Math.round((item.count / maxIngestCount) * 100))}%`,
                        height: "100%",
                        background: "linear-gradient(90deg, #5fc1ff, #1f4f6d)",
                      }}
                    />
                  </div>
                </div>
              )) : <p className="authMessage">No ingestion data available.</p>}
            </div>
          </section>

          <section className="panel featurePanel">
            <div className="panelHeading">
              <span>Edit Videos</span>
              <strong>{videos.length} rows</strong>
            </div>
            <div className="interactiveStack">
            <label>
              <span>Import by YouTube URL or ID</span>
              <input
                value={videoImportSource}
                onChange={(event) => setVideoImportSource(event.target.value)}
                placeholder="https://youtu.be/... or https://www.youtube.com/watch?v=..."
              />
            </label>
            <button type="button" onClick={() => void importVideoFromSource()} disabled={ingestingVideo}>
              {ingestingVideo ? "Importing..." : "Import Video"}
            </button>
            <label>
              <span>Search</span>
              <input value={videoQuery} onChange={(event) => setVideoQuery(event.target.value)} placeholder="videoId, title, artist, track" />
            </label>
            <button type="button" onClick={() => void loadVideos()}>Refresh Video Search</button>
            {videos.slice(0, 25).map((row) => (
              <div key={row.id} className="authForm">
                <p className="authMessage">{row.videoId}</p>
                <label>
                  <span>Title</span>
                  <input
                    value={row.title}
                    onChange={(event) => {
                      const next = videos.map((item) => (item.id === row.id ? { ...item, title: event.target.value } : item));
                      setVideos(next);
                    }}
                  />
                </label>
                <label>
                  <span>Artist</span>
                  <input
                    value={row.parsedArtist ?? ""}
                    onChange={(event) => {
                      const next = videos.map((item) => (item.id === row.id ? { ...item, parsedArtist: event.target.value || null } : item));
                      setVideos(next);
                    }}
                  />
                </label>
                <label>
                  <span>Track</span>
                  <input
                    value={row.parsedTrack ?? ""}
                    onChange={(event) => {
                      const next = videos.map((item) => (item.id === row.id ? { ...item, parsedTrack: event.target.value || null } : item));
                      setVideos(next);
                    }}
                  />
                </label>
                <button type="button" onClick={() => void saveVideo(row)}>Save Video</button>
              </div>
            ))}
            </div>
          </section>
        </>
      ) : null}

      {activeTab === "artists" ? (
        <section className="panel featurePanel">
          <div className="panelHeading">
            <span>Edit Artists</span>
            <strong>{artists.length} rows</strong>
          </div>
          <div className="interactiveStack">
            <label>
              <span>Search</span>
              <input value={artistQuery} onChange={(event) => setArtistQuery(event.target.value)} placeholder="artist, country, genre" />
            </label>
            <button type="button" onClick={() => void loadArtists()}>Refresh Artist Search</button>
            {artists.slice(0, 25).map((row) => (
              <div key={row.id} className="authForm">
                <label>
                  <span>Name</span>
                  <input
                    value={row.name}
                    onChange={(event) => {
                      const next = artists.map((item) => (item.id === row.id ? { ...item, name: event.target.value } : item));
                      setArtists(next);
                    }}
                  />
                </label>
                <label>
                  <span>Country</span>
                  <input
                    value={row.country ?? ""}
                    onChange={(event) => {
                      const next = artists.map((item) => (item.id === row.id ? { ...item, country: event.target.value || null } : item));
                      setArtists(next);
                    }}
                  />
                </label>
                <label>
                  <span>Genre 1</span>
                  <input
                    value={row.genre1 ?? ""}
                    onChange={(event) => {
                      const next = artists.map((item) => (item.id === row.id ? { ...item, genre1: event.target.value || null } : item));
                      setArtists(next);
                    }}
                  />
                </label>
                <button type="button" onClick={() => void saveArtist(row)}>Save Artist</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "ambiguous" ? (
        <section className="panel featurePanel">
          <div className="panelHeading">
            <span>Ambiguous Videos</span>
            <strong>{ambiguousVideos.length} rows</strong>
          </div>
          <div className="interactiveStack">
            <p className="authMessage">
              Videos shown here are likely non-music or weakly classified. Choose Keep to approve, Delete to remove.
            </p>
            <label>
              <span>Search</span>
              <input
                value={ambiguousQuery}
                onChange={(event) => setAmbiguousQuery(event.target.value)}
                placeholder="videoId, title, artist, track"
              />
            </label>
            <button type="button" onClick={() => void loadAmbiguousVideos()}>Refresh Ambiguous List</button>
            {ambiguousVideos.map((row) => (
              <div key={row.id} className="authForm">
                <p className="authMessage"><strong>{row.videoId}</strong></p>
                <p className="authMessage">{row.title}</p>
                {row.channelTitle ? <p className="authMessage">Channel: {row.channelTitle}</p> : null}
                <p className="authMessage">
                  Artist: {row.parsedArtist ?? "n/a"} | Track: {row.parsedTrack ?? "n/a"} | Type: {row.parsedVideoType ?? "n/a"} | Confidence: {row.parseConfidence ?? "n/a"}
                </p>
                {row.parseMethod || row.parseReason ? (
                  <p className="authMessage">{row.parseMethod ?? ""} {row.parseReason ? `| ${row.parseReason}` : ""}</p>
                ) : null}
                <div className="primaryActions compactActions">
                  <button
                    type="button"
                    onClick={() => void moderateAmbiguousVideo(row.videoId, "keep")}
                    disabled={moderatingVideoId === row.videoId}
                  >
                    {moderatingVideoId === row.videoId ? "Working..." : "Keep"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void moderateAmbiguousVideo(row.videoId, "delete")}
                    disabled={moderatingVideoId === row.videoId}
                  >
                    {moderatingVideoId === row.videoId ? "Working..." : "Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
