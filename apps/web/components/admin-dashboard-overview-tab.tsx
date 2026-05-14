import { Dial } from "@/components/admin-dashboard-shared-ui";
import type { AnalyticsBucket, AnalyticsZoomLevel, DashboardPayload } from "@/components/admin-dashboard-types";

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
  returnVisits: boolean;
  magazineExternalLandings: boolean;
  authEvents: boolean;
};

type AnalyticsPoint = {
  x: number;
  yPageViews: number;
  yVideoViews: number;
  yVisitors: number;
  yReturnVisits: number;
  yMagazineExternalLandings: number;
  yAuthEvents: number;
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

type AnalyticsGraph = {
  width: number;
  height: number;
  axis: { paddingLeft: number; paddingRight: number; paddingTop: number; paddingBottom: number };
  yTicks: Array<{ y: number; value: number }>;
  xTicks: Array<{ x: number; label: string }>;
  points: AnalyticsPoint[];
  pageViewsPath: string;
  videoViewsPath: string;
  visitorsPath: string;
  returnVisitsPath: string;
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
}: AdminDashboardOverviewTabProps) {
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
          {([
            { key: "pageViews", label: "Page Views", color: "#ff9d5c" },
            { key: "videoViews", label: "Video Views", color: "#5fc1ff" },
            { key: "visitors", label: "Unique Visitors", color: "#7ce0a3" },
            { key: "returnVisits", label: "Return Visits", color: "#9e86ff" },
            { key: "magazineExternalLandings", label: "Magazine External Landings", color: "#ff4d4d" },
            { key: "authEvents", label: "Auth Events", color: "#ffd1c4" },
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

      <p className="authMessage" style={{ margin: 0 }} />

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
                  onSelectAnalyticsPoint({
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
  );
}
