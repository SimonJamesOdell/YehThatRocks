"use client";

import { useEffect, useRef, useState } from "react";

import { Dial } from "@/components/admin-dashboard-shared-ui";
import type { AnalyticsBucket, AnalyticsZoomLevel, DashboardPayload, TrafficAdjustmentSeries } from "@/components/admin-dashboard-types";

type HostMetricSeriesOn = {
  cpu: boolean;
  memory: boolean;
  swap: boolean;
  disk: boolean;
  network: boolean;
};

type AnalyticsSeriesOn = {
  pageViews: boolean;
  videoViews: boolean;
  visitors: boolean;
  newVisitors: boolean;
  returnVisits: boolean;
  sessions: boolean;
  magazineExternalLandings: boolean;
  authEvents: boolean;
};

type AnalyticsPoint = {
  x: number;
  yPageViews: number;
  yVideoViews: number;
  yVisitors: number;
  yNewVisitors: number;
  yReturnVisits: number;
  yMagazineExternalLandings: number;
  yAuthEvents: number;
  ySessions: number;
  bucketStart: string;
  bucketEnd: string;
  label: string;
  pageViews: number;
  videoViews: number;
  uniqueVisitors: number;
  newVisitors: number;
  returnVisits: number;
  magazineExternalLandings: number;
  authEvents: number;
  sessions: number;
};

type AnalyticsGraph = {
  width: number;
  height: number;
  maxVal: number;
  axis: { paddingLeft: number; paddingRight: number; paddingTop: number; paddingBottom: number };
  yTicks: Array<{ y: number; value: number }>;
  xTicks: Array<{ x: number; label: string }>;
  points: AnalyticsPoint[];
  pageViewsPath: string;
  videoViewsPath: string;
  visitorsPath: string;
  newVisitorsPath: string;
  returnVisitsPath: string;
  sessionsPath: string;
  magazineExternalLandingsPath: string;
  authEventsPath: string;
};

type HostMetricsGraph = {
  width: number;
  height: number;
  axis: { paddingLeft: number; paddingRight: number; paddingTop: number; paddingBottom: number };
  yTicks: Array<{ y: number; value: number }>;
  xTicks: Array<{ x: number; label: string }>;
  cpuPath: string;
  memoryPath: string;
  swapPath: string;
  diskPath: string;
  networkPath: string;
};

type SeriesYKey =
  | "yPageViews"
  | "yVideoViews"
  | "yVisitors"
  | "yNewVisitors"
  | "yReturnVisits"
  | "ySessions"
  | "yMagazineExternalLandings"
  | "yAuthEvents";

type SeriesValueKey =
  | "pageViews"
  | "videoViews"
  | "uniqueVisitors"
  | "newVisitors"
  | "returnVisits"
  | "sessions"
  | "magazineExternalLandings"
  | "authEvents";

type SeriesPathKey =
  | "pageViewsPath"
  | "videoViewsPath"
  | "visitorsPath"
  | "newVisitorsPath"
  | "returnVisitsPath"
  | "sessionsPath"
  | "magazineExternalLandingsPath"
  | "authEventsPath";

const TRAFFIC_SERIES_META: Array<{
  key: TrafficAdjustmentSeries;
  label: string;
  color: string;
  yKey: SeriesYKey;
  valueKey: SeriesValueKey;
  pathKey: SeriesPathKey;
  dash?: boolean;
}> = [
  { key: "pageViews", label: "Page Views", color: "#ff9d5c", yKey: "yPageViews", valueKey: "pageViews", pathKey: "pageViewsPath" },
  { key: "videoViews", label: "Video Views", color: "#5fc1ff", yKey: "yVideoViews", valueKey: "videoViews", pathKey: "videoViewsPath" },
  { key: "visitors", label: "Unique Visitors", color: "#7ce0a3", yKey: "yVisitors", valueKey: "uniqueVisitors", pathKey: "visitorsPath" },
  { key: "newVisitors", label: "New Visitors", color: "#4dd0e1", yKey: "yNewVisitors", valueKey: "newVisitors", pathKey: "newVisitorsPath" },
  { key: "returnVisits", label: "Return Visits", color: "#9e86ff", yKey: "yReturnVisits", valueKey: "returnVisits", pathKey: "returnVisitsPath" },
  { key: "magazineExternalLandings", label: "Magazine External Landings", color: "#ff4d4d", yKey: "yMagazineExternalLandings", valueKey: "magazineExternalLandings", pathKey: "magazineExternalLandingsPath" },
  { key: "authEvents", label: "Auth Events", color: "#ffd1c4", yKey: "yAuthEvents", valueKey: "authEvents", pathKey: "authEventsPath" },
  { key: "sessions", label: "Sessions", color: "#f0c040", yKey: "ySessions", valueKey: "sessions", pathKey: "sessionsPath", dash: true },
];

// Hourly rollups only carry a subset of the series; everything else is editable.
const HOURLY_EDITABLE_SERIES: ReadonlySet<TrafficAdjustmentSeries> = new Set([
  "pageViews",
  "videoViews",
  "visitors",
  "returnVisits",
  "authEvents",
]);

function isSeriesEditableAtZoom(key: TrafficAdjustmentSeries, isHourlyZoom: boolean): boolean {
  return !isHourlyZoom || HOURLY_EDITABLE_SERIES.has(key);
}

function pointerSvgY(event: { currentTarget: SVGCircleElement; clientX: number; clientY: number }): number | null {
  const svg = event.currentTarget.ownerSVGElement;
  if (!svg) {
    return null;
  }

  const ctm = svg.getScreenCTM();
  if (!ctm) {
    return null;
  }

  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;

  return point.matrixTransform(ctm.inverse()).y;
}

function valueFromGraphY(y: number, graph: AnalyticsGraph): number {
  const chartHeight = graph.height - graph.axis.paddingTop - graph.axis.paddingBottom;
  if (chartHeight <= 0) {
    return 0;
  }

  const ratio = (graph.axis.paddingTop + chartHeight - y) / chartHeight;
  const value = ratio * graph.maxVal;

  return Math.max(0, Math.min(graph.maxVal, Math.round(value)));
}

function buildPreviewPath(points: AnalyticsPoint[], yKey: SeriesYKey, overrideIndex: number, overrideY: number): string {
  return points
    .map((point, index) => {
      const y = index === overrideIndex ? overrideY : point[yKey];
      return `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

type AdminDashboardOverviewTabProps = {
  dashboard: DashboardPayload | null;
  cpuAvgPeakText: string;
  showHostMetricsGraph: boolean;
  onToggleShowHostMetricsGraph: () => void;
  hostMetricSeriesOn: HostMetricSeriesOn;
  onToggleHostMetricSeries: (key: keyof HostMetricSeriesOn) => void;
  hostMetricRowsLength: number;
  hostMetricsGraph: HostMetricsGraph;
  analyticsZoomLevel: AnalyticsZoomLevel;
  onSelectAnalyticsZoom: (zoom: AnalyticsZoomLevel) => void;
  refreshingAnalytics: boolean;
  onRefreshOverviewAnalytics: () => void;
  analyticsSeriesOn: AnalyticsSeriesOn;
  onToggleAnalyticsSeries: (key: keyof AnalyticsSeriesOn) => void;
  analyticsGraph: AnalyticsGraph;
  onSelectAnalyticsPoint: (point: AnalyticsBucket) => void;
  trafficEditEnabled: boolean;
  onToggleTrafficEdit: () => void;
  onAdjustTrafficPoint: (payload: {
    series: TrafficAdjustmentSeries;
    bucketStart: string;
    bucketEnd: string;
    targetValue: number;
  }) => Promise<void>;
};

export function AdminDashboardOverviewTab({
  dashboard,
  cpuAvgPeakText,
  showHostMetricsGraph,
  onToggleShowHostMetricsGraph,
  hostMetricSeriesOn,
  onToggleHostMetricSeries,
  hostMetricRowsLength,
  hostMetricsGraph,
  analyticsZoomLevel,
  onSelectAnalyticsZoom,
  refreshingAnalytics,
  onRefreshOverviewAnalytics,
  analyticsSeriesOn,
  onToggleAnalyticsSeries,
  analyticsGraph,
  onSelectAnalyticsPoint,
  trafficEditEnabled,
  onToggleTrafficEdit,
  onAdjustTrafficPoint,
}: AdminDashboardOverviewTabProps) {
  const isHourlyZoom = analyticsZoomLevel === "hourly";
  const trafficEditingActive = trafficEditEnabled;
  const [preview, setPreview] = useState<{
    series: TrafficAdjustmentSeries;
    bucketStart: string;
    y: number;
    value: number;
  } | null>(null);
  const activeDragRef = useRef<{
    series: TrafficAdjustmentSeries;
    bucketStart: string;
    bucketEnd: string;
    originalValue: number;
    grabOffsetY: number;
    latestValue: number;
  } | null>(null);

  useEffect(() => {
    activeDragRef.current = null;
    setPreview(null);
  }, [analyticsZoomLevel, trafficEditEnabled]);

  const previewPath = preview
    ? (() => {
        const index = analyticsGraph.points.findIndex((point) => point.bucketStart === preview.bucketStart);
        return index < 0 ? null : { series: preview.series, index, y: preview.y };
      })()
    : null;

  const startTrafficDrag = (
    meta: (typeof TRAFFIC_SERIES_META)[number],
    point: AnalyticsPoint,
    event: { currentTarget: SVGCircleElement; clientX: number; clientY: number; pointerId: number; stopPropagation: () => void },
  ) => {
    if (!trafficEditingActive) {
      return;
    }

    event.stopPropagation();

    const svgY = pointerSvgY(event);
    if (svgY == null) {
      return;
    }

    activeDragRef.current = {
      series: meta.key,
      bucketStart: point.bucketStart,
      bucketEnd: point.bucketEnd,
      originalValue: point[meta.valueKey],
      grabOffsetY: svgY - point[meta.yKey],
      latestValue: point[meta.valueKey],
    };

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; movement still updates via pointermove.
    }
  };

  const moveTrafficDrag = (
    meta: (typeof TRAFFIC_SERIES_META)[number],
    point: AnalyticsPoint,
    event: { currentTarget: SVGCircleElement; clientX: number; clientY: number; stopPropagation: () => void },
  ) => {
    const active = activeDragRef.current;
    if (!active || active.series !== meta.key || active.bucketStart !== point.bucketStart) {
      return;
    }

    event.stopPropagation();

    const svgY = pointerSvgY(event);
    if (svgY == null) {
      return;
    }

    const chartHeight = analyticsGraph.height - analyticsGraph.axis.paddingTop - analyticsGraph.axis.paddingBottom;
    const handleY = svgY - active.grabOffsetY;
    const value = valueFromGraphY(handleY, analyticsGraph);
    const clampedY = Math.max(
      analyticsGraph.axis.paddingTop,
      Math.min(analyticsGraph.axis.paddingTop + chartHeight, handleY),
    );
    active.latestValue = value;

    setPreview({
      series: active.series,
      bucketStart: active.bucketStart,
      y: clampedY,
      value,
    });
  };

  const endTrafficDrag = (meta: (typeof TRAFFIC_SERIES_META)[number], point: AnalyticsPoint) => {
    const active = activeDragRef.current;
    if (!active || active.series !== meta.key || active.bucketStart !== point.bucketStart) {
      return;
    }

    activeDragRef.current = null;
    const finalValue = active.latestValue;
    setPreview(null);

    if (finalValue !== active.originalValue) {
      void onAdjustTrafficPoint({
        series: active.series,
        bucketStart: active.bucketStart,
        bucketEnd: active.bucketEnd,
        targetValue: finalValue,
      });
    }
  };

  const cancelTrafficDrag = () => {
    activeDragRef.current = null;
    setPreview(null);
  };

  return (
    <div className="adminOverviewStack">
      <div className="adminOverviewHealthLayout">
        <div className="adminOverviewDialsColumn">
          <div className="adminOverviewDials">
            <Dial label="Memory" value={dashboard?.health.host.memoryUsagePercent ?? null} color="#ffc14d" />
            <Dial label="Swap" value={dashboard?.health.host.swapUsagePercent ?? null} color="#f5d96b" />
            <Dial label="CPU" value={dashboard?.health.host.cpuUsagePercent ?? null} color="#ff6f43" detail={cpuAvgPeakText} />
            <Dial label="Disk" value={dashboard?.health.host.diskUsagePercent ?? null} color="#7ce0a3" />
            <Dial label="Network" value={dashboard?.health.host.networkUsagePercent ?? null} color="#5fc1ff" />
          </div>
          <div className="adminOverviewGraphToggleRow">
            <button
              type="button"
              onClick={onToggleShowHostMetricsGraph}
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

      {/* Engagement cards */}
      {dashboard?.analytics.engagement ? (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 0, marginBottom: 12 }}>
          <div style={{
            borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.03)", padding: "10px 16px",
            minWidth: 140, textAlign: "center",
          }}>
            <div style={{ fontSize: 10, opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.06em" }}>Pages / Session</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#ff9d5c" }}>
              {dashboard.analytics.engagement.pagesPerSession.toFixed(1)}
            </div>
          </div>
          <div style={{
            borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.03)", padding: "10px 16px",
            minWidth: 140, textAlign: "center",
          }}>
            <div style={{ fontSize: 10, opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.06em" }}>Videos / Session</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#5fc1ff" }}>
              {dashboard.analytics.engagement.videosPerSession.toFixed(1)}
            </div>
          </div>
        </div>
      ) : null}

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
              ] as Array<{ key: keyof HostMetricSeriesOn; label: string; color: string }>).map(({ key, label, color }) => (
                <button
                  key={`host-metric-${key}`}
                  type="button"
                  onClick={() => onToggleHostMetricSeries(key)}
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
            viewBox={hostMetricRowsLength > 0 ? `0 0 ${hostMetricsGraph.width} ${hostMetricsGraph.height}` : "0 0 680 220"}
            role="img"
            aria-label="Host metrics chart — CPU, memory, swap, disk, network over the last 24 hours"
            style={{ width: "100%", height: "clamp(250px, 42vh, 560px)", borderRadius: 10, background: "rgba(255,255,255,0.04)" }}
          >
            {hostMetricRowsLength === 0 ? (
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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 11, opacity: 0.5, letterSpacing: "0.06em", textTransform: "uppercase" }} />
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
              onClick={() => onSelectAnalyticsZoom(key)}
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
            onClick={onRefreshOverviewAnalytics}
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
          <button
            type="button"
            onClick={onToggleTrafficEdit}
            style={{
              borderRadius: 999,
              border: `1px solid ${trafficEditEnabled ? "rgba(124,224,163,0.6)" : "rgba(255,255,255,0.18)"}`,
              background: trafficEditEnabled ? "rgba(124,224,163,0.16)" : "rgba(255,255,255,0.04)",
              color: trafficEditEnabled ? "#7ce0a3" : "rgba(255,255,255,0.9)",
              padding: "7px 12px",
              cursor: "pointer",
            }}
          >
            {trafficEditEnabled ? "Editing traffic ✓" : "Edit traffic"}
          </button>
          {([
            { key: "pageViews", label: "Page Views", color: "#ff9d5c" },
            { key: "videoViews", label: "Video Views", color: "#5fc1ff" },
            { key: "visitors", label: "Unique Visitors", color: "#7ce0a3" },
            { key: "newVisitors", label: "New Visitors", color: "#4dd0e1" },
            { key: "returnVisits", label: "Return Visits", color: "#9e86ff" },
            { key: "magazineExternalLandings", label: "Magazine External Landings", color: "#ff4d4d" },
            { key: "authEvents", label: "Auth Events", color: "#ffd1c4" },
            { key: "sessions" as keyof AnalyticsSeriesOn, label: "Sessions", color: "#f0c040" },
          ] as Array<{ key: keyof AnalyticsSeriesOn; label: string; color: string }>).map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => onToggleAnalyticsSeries(key)}
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

      {trafficEditEnabled ? (
        <p className="authMessage" style={{ margin: "6px 0 0" }}>
          {isHourlyZoom
            ? "Drag a handle up or down to directly edit that record. Hourly only carries page views, video views, visitors, return visits and auth events."
            : "Drag a handle up or down to directly edit that traffic record. The change is written to the source data and survives recomputes."}
        </p>
      ) : null}

      <svg
        viewBox={analyticsGraph.points.length > 0 ? `0 0 ${analyticsGraph.width} ${analyticsGraph.height}` : "0 0 680 250"}
        role="img"
        aria-label="Analytics chart — page views, video views, unique visitors, new visitors, return visits, magazine external landings, auth events"
        style={{ width: "100%", height: "clamp(260px, 46vh, 620px)", borderRadius: 10, background: "rgba(255,255,255,0.04)", userSelect: "none" }}
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
            {TRAFFIC_SERIES_META.filter((meta) => analyticsSeriesOn[meta.key]).map((meta) => {
              const path = previewPath && previewPath.series === meta.key
                ? buildPreviewPath(analyticsGraph.points, meta.yKey, previewPath.index, previewPath.y)
                : analyticsGraph[meta.pathKey];

              return (
                <path
                  key={`analytics-path-${meta.key}`}
                  d={path}
                  fill="none"
                  stroke={meta.color}
                  strokeWidth={meta.dash ? 2 : 2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={meta.dash ? "6 3" : undefined}
                />
              );
            })}
            {analyticsGraph.points.map((point) => (
              <g
                key={`${point.bucketStart}-${point.bucketEnd}`}
                onClick={trafficEditEnabled ? undefined : () => {
                  onSelectAnalyticsPoint({
                    bucketStart: point.bucketStart,
                    bucketEnd: point.bucketEnd,
                    label: point.label,
                    pageViews: point.pageViews,
                    videoViews: point.videoViews,
                    uniqueVisitors: point.uniqueVisitors,
                    newVisitors: point.newVisitors ?? 0,
                    returnVisits: point.returnVisits,
                    magazineExternalLandings: point.magazineExternalLandings,
                    authEvents: point.authEvents,
                    sessions: point.sessions ?? 0,
                  });
                }}
                style={{ cursor: !trafficEditEnabled && (analyticsZoomLevel === "allTime" || analyticsZoomLevel === "monthly" || analyticsZoomLevel === "weekly") ? "pointer" : "default" }}
              >
                {TRAFFIC_SERIES_META.filter((meta) => analyticsSeriesOn[meta.key]).map((meta) => {
                  const y = preview && preview.series === meta.key && preview.bucketStart === point.bucketStart
                    ? preview.y
                    : point[meta.yKey];

                  return (
                    <circle
                      key={`${meta.key}-dot`}
                      cx={point.x}
                      cy={y}
                      r={meta.dash ? 3 : 3.5}
                      fill={meta.color}
                    />
                  );
                })}
                {trafficEditingActive ? (
                  TRAFFIC_SERIES_META.filter((meta) => analyticsSeriesOn[meta.key] && isSeriesEditableAtZoom(meta.key, isHourlyZoom)).map((meta) => {
                    const y = preview && preview.series === meta.key && preview.bucketStart === point.bucketStart
                      ? preview.y
                      : point[meta.yKey];

                    return (
                      <circle
                        key={`${meta.key}-handle`}
                        cx={point.x}
                        cy={y}
                        r={11}
                        fill="transparent"
                        style={{ cursor: "ns-resize", touchAction: "none" }}
                        onPointerDown={(event) => startTrafficDrag(meta, point, event)}
                        onPointerMove={(event) => moveTrafficDrag(meta, point, event)}
                        onPointerUp={() => endTrafficDrag(meta, point)}
                        onPointerCancel={cancelTrafficDrag}
                      />
                    );
                  })
                ) : null}
                <title>{`${point.label} (${new Date(point.bucketStart).toLocaleString()} - ${new Date(point.bucketEnd).toLocaleString()}) — Page views: ${point.pageViews}, Video views: ${point.videoViews}, Visitors: ${point.uniqueVisitors}, New visitors: ${point.newVisitors ?? 0}, Return visits: ${point.returnVisits}, Magazine external landings: ${point.magazineExternalLandings}, Auth events: ${point.authEvents}, Sessions: ${point.sessions ?? 0}`}</title>
              </g>
            ))}
          </>
        )}
      </svg>
    </div>
  );
}
