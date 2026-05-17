import type { DashboardPayload } from "@/components/admin-dashboard-types";

type AdminDashboardPerformanceTabProps = {
  dashboard: DashboardPayload | null;
  resettingPerfWindow: boolean;
  onResetPerfWindow: () => void;
};

export function AdminDashboardPerformanceTab({
  dashboard,
  resettingPerfWindow,
  onResetPerfWindow,
}: AdminDashboardPerformanceTabProps) {
  return (
    <>
      <section className="panel featurePanel">
        <div className="interactiveStack">
          <div className="primaryActions compactActions" style={{ justifyContent: "center" }}>
            <button
              type="button"
              onClick={onResetPerfWindow}
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
            <div><strong>Wiki cache files</strong><p>{dashboard.insights.memoryDiagnostics.caches.wikiCacheCount}</p></div>
          </div>
        </section>
      ) : null}
    </>
  );
}
