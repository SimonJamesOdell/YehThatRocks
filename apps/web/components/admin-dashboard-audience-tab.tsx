import type { AudienceWindowData, DashboardPayload } from "@/components/admin-dashboard-types";

type AdminDashboardAudienceTabProps = {
  dashboard: DashboardPayload | null;
};

function maxPeople(freq: AudienceWindowData["frequencyDistribution"]) {
  return Math.max(1, ...freq.map((f) => f.people));
}

function FrequencySection({ label, data }: { label: string; data: AudienceWindowData }) {
  const totalReturning = data.returningVisitorCount;
  const peak = maxPeople(data.frequencyDistribution);
  const didNotReturn = Math.max(0, data.totalVisitorCount - totalReturning);
  const barMax = Math.max(peak, didNotReturn);

  return (
    <section className="panel featurePanel" style={{ marginTop: 6 }}>
      <div className="panelHeading">
        <span>Returning Visitor Frequency</span>
        <strong>{label} &middot; {totalReturning} returning of {data.totalVisitorCount} total</strong>
      </div>
      <div style={{ padding: "8px 0" }}>
        {data.frequencyDistribution.length === 0 && didNotReturn === 0 ? (
          <p style={{ fontSize: 13, opacity: 0.4, padding: "20px 0", textAlign: "center" }}>
            No returning visitor data yet.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
              <span style={{ width: 80, textAlign: "right", opacity: 0.7, flexShrink: 0 }}>Did not return</span>
              <div style={{ flex: 1, height: 20, borderRadius: 4, background: "rgba(255,111,67,0.12)", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: Math.round((didNotReturn / barMax) * 100) + "%", minWidth: didNotReturn > 0 ? 3 : 0, borderRadius: 4, background: "linear-gradient(90deg, rgba(255,111,67,0.45), rgba(255,111,67,0.75))" }} />
              </div>
              <span style={{ width: 50, fontWeight: 700, color: "#ff6f43", fontVariantNumeric: "tabular-nums" }}>{didNotReturn}</span>
            </div>
            {data.frequencyDistribution.map((bucket) => {
              const barPct = Math.round((bucket.people / peak) * 100);
              return (
                <div key={bucket.daysMin} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                  <span style={{ width: 80, textAlign: "right", opacity: 0.7, flexShrink: 0 }}>{bucket.label}</span>
                  <div style={{ flex: 1, height: 20, borderRadius: 4, background: "rgba(158,134,255,0.12)", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: barPct + "%", minWidth: bucket.people > 0 ? 3 : 0, borderRadius: 4, background: "linear-gradient(90deg, rgba(158,134,255,0.45), rgba(158,134,255,0.75))", transition: "width 0.3s ease" }} />
                  </div>
                  <span style={{ width: 50, fontWeight: 700, color: "#9e86ff", fontVariantNumeric: "tabular-nums" }}>{bucket.people}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export function AdminDashboardAudienceTab({
  dashboard,
}: AdminDashboardAudienceTabProps) {
  const audience = dashboard?.audience;
  const analytics = dashboard?.analytics;

  if (!audience) {
    return (
      <section className="panel featurePanel">
        <div className="panelHeading">
          <span>Audience</span>
          <strong>Loading&hellip;</strong>
        </div>
      </section>
    );
  }

  // Extract today's numbers from the daily series (correct unique-visitor counts)
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayBucket = analytics?.series?.daily?.find(
    (b) => b.bucketStart?.slice(0, 10) === todayStr,
  );
  const todayVisitors = todayBucket?.uniqueVisitors ?? 0;
  const todayReturning = todayBucket?.returnVisits ?? 0;

  return (
    <div className="adminOverviewStack">
      {/* Daily snapshot card */}
      {analytics ? (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{
            borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.03)", padding: "10px 16px",
            minWidth: 140, textAlign: "center",
          }}>
            <div style={{ fontSize: 10, opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.06em" }}>Today — Visitors</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#7ce0a3" }}>
              {todayVisitors}
            </div>
          </div>
          <div style={{
            borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.03)", padding: "10px 16px",
            minWidth: 140, textAlign: "center",
          }}>
            <div style={{ fontSize: 10, opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.06em" }}>Today — Returning</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#9e86ff" }}>
              {todayReturning}
            </div>
          </div>
          <div style={{
            borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.03)", padding: "10px 16px",
            minWidth: 140, textAlign: "center",
          }}>
            <div style={{ fontSize: 10, opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.06em" }}>Pages / Session</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#ff9d5c" }}>
              {analytics.engagement.pagesPerSession.toFixed(1)}
            </div>
          </div>
          <div style={{
            borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.03)", padding: "10px 16px",
            minWidth: 140, textAlign: "center",
          }}>
            <div style={{ fontSize: 10, opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.06em" }}>Videos / Session</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#5fc1ff" }}>
              {analytics.engagement.videosPerSession.toFixed(1)}
            </div>
          </div>
        </div>
      ) : null}

      <FrequencySection label="last 30 days" data={audience} />
      <FrequencySection label="last 60 days" data={audience.window60} />
      <FrequencySection label="last 90 days" data={audience.window90} />

      {/* Retention cohorts */}
      <section className="panel featurePanel" style={{ marginTop: 6 }}>
        <div className="panelHeading">
          <span>New Visitor Retention</span>
          <strong>what % of first-time visitors come back?</strong>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "8px 0" }}>
          {audience.retentionCohorts.map((cohort) => (
            <div
              key={cohort.label}
              style={{
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.03)",
                padding: "14px 18px",
                minWidth: 150,
                textAlign: "center",
                flex: 1,
              }}
            >
              <div style={{
                fontSize: 10,
                opacity: 0.5,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 6,
              }}>
                {cohort.label} retention
              </div>
              <div style={{
                fontSize: 32,
                fontWeight: 700,
                color: cohort.rate >= 20 ? "#7ce0a3" : cohort.rate >= 10 ? "#ffc14d" : "#ff6f43",
                lineHeight: 1,
                marginBottom: 4,
              }}>
                {cohort.rate}%
              </div>
              <div style={{ fontSize: 11, opacity: 0.45 }}>
                {cohort.returned} of {cohort.cohortSize} came back
                {cohort.cohortSize === 0 ? " (no new visitors that day)" : ""}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Explanation */}
      <section className="panel featurePanel" style={{ marginTop: 6 }}>
        <div className="panelHeading">
          <span>How to read this</span>
        </div>
        <div style={{ fontSize: 12, opacity: 0.6, lineHeight: 1.6, padding: "8px 0" }}>
          <p style={{ margin: "0 0 8px" }}>
            <strong>Frequency</strong> — Of all distinct visitors who returned at least once in the last 30 days,
            how many distinct days did each person visit? &ldquo;1 day&rdquo; means they came back exactly
            once this month — a casual returner. &ldquo;8&ndash;14 days&rdquo; or &ldquo;15+ days&rdquo;
            are your dedicated regulars.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Retention</strong> — Of the first-time visitors who showed up 7 (or 30) days ago,
            what percentage returned at any point since? This measures whether new visitors
            find the site compelling enough to come back.
          </p>
        </div>
      </section>
    </div>
  );
}
