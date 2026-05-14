import type { DashboardPayload, QuotaBackfillStatus } from "@/components/admin-dashboard-types";

type ApiUsageGraph = {
  width: number;
  height: number;
  chartHeight: number;
  barWidth: number;
  axis: {
    paddingLeft: number;
    paddingRight: number;
    paddingTop: number;
    paddingBottom: number;
  };
  yTicks: Array<{ y: number; value: number }>;
  bars: Array<{
    x: number;
    youtubeHeight: number;
    groqHeight: number;
    groqClassifiedHeight: number;
    label: string;
    youtubeUnits: number;
    groqCalls: number;
    groqClassified: number;
  }>;
};

type AdminDashboardApiTabProps = {
  apiUsageTotals7d: DashboardPayload["insights"]["apiUsage"]["totals7d"] | undefined;
  apiUsageGraph: ApiUsageGraph;
  quotaStatus: QuotaBackfillStatus | null;
  msUntilReset: number | null;
  backfillRunning: boolean;
  backfillResult: string | null;
  onTriggerBackfill: (budgetUnits: number) => void;
  onLoadQuotaStatus: () => void;
};

export function AdminDashboardApiTab({
  apiUsageTotals7d,
  apiUsageGraph,
  quotaStatus,
  msUntilReset,
  backfillRunning,
  backfillResult,
  onTriggerBackfill,
  onLoadQuotaStatus,
}: AdminDashboardApiTabProps) {
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
              onClick={() => onTriggerBackfill(quotaStatus?.recommendedBudget ?? 0)}
              disabled={backfillRunning || !quotaStatus || quotaStatus.recommendedBudget < 100}
            >
              {backfillRunning ? "Running…" : "Run Backfill Now"}
            </button>
            <button type="button" onClick={onLoadQuotaStatus} disabled={backfillRunning}>
              Refresh Status
            </button>
          </div>

          <p className="authMessage" style={{ opacity: 0.6 }}>
            Backfill runs shallow (depth 1) related discovery for catalog videos that have no cached related data.
            Each seed uses ~100 YouTube API units. Auto-triggers 2 minutes before daily quota reset if ≥500 units remain.
          </p>
        </div>
      </section>
    </div>
  );
}
