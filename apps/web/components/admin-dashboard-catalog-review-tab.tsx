import type { MutableRefObject } from "react";

import type { CatalogReviewVideoRow } from "@/components/admin-dashboard-types";

type AdminDashboardCatalogReviewTabProps = {
  catalogReviewRemaining: number;
  catalogReviewCurrentVideo: CatalogReviewVideoRow | null;
  catalogReviewActionVideoId: string | null;
  previousCatalogAction: { action: "approve" | "remove"; videoId: string } | null;
  reversingCatalogAction: boolean;
  catalogReviewPreviewIframeRef: MutableRefObject<HTMLIFrameElement | null>;
  catalogReviewPreviewCurrentTimeRef: MutableRefObject<number | null>;
  onSeekCatalogReviewPreview: (seconds: number) => void;
  onRefreshCatalogReviewMetadata: () => Promise<void>;
  onModerateCatalogReviewVideo: (action: "approve" | "remove") => Promise<void>;
  onReversePreviousCatalogAction: () => Promise<void>;
};

export function AdminDashboardCatalogReviewTab({
  catalogReviewRemaining,
  catalogReviewCurrentVideo,
  catalogReviewActionVideoId,
  previousCatalogAction,
  reversingCatalogAction,
  catalogReviewPreviewIframeRef,
  catalogReviewPreviewCurrentTimeRef,
  onSeekCatalogReviewPreview,
  onRefreshCatalogReviewMetadata,
  onModerateCatalogReviewVideo,
  onReversePreviousCatalogAction,
}: AdminDashboardCatalogReviewTabProps) {
  return (
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
                    onClick={() => {
                      void onRefreshCatalogReviewMetadata();
                    }}
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
                          onSeekCatalogReviewPreview(baseStartAtSec);
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
                        onSeekCatalogReviewPreview(nextStartAtSec);
                      }}
                      disabled={catalogReviewActionVideoId === row.videoId}
                    >
                      Skip +20s
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void onModerateCatalogReviewVideo("approve");
                      }}
                      disabled={catalogReviewActionVideoId === row.videoId}
                    >
                      Keep Video
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void onModerateCatalogReviewVideo("remove");
                      }}
                      disabled={catalogReviewActionVideoId === row.videoId}
                    >
                      Remove Video
                    </button>
                    {previousCatalogAction ? (
                      <button
                        type="button"
                        onClick={() => {
                          void onReversePreviousCatalogAction();
                        }}
                        disabled={reversingCatalogAction}
                        style={{
                          borderColor: "rgba(255,200,100,0.45)",
                          background: "rgba(255,200,100,0.12)",
                          color: "#ffc864",
                          cursor: reversingCatalogAction ? "wait" : "pointer",
                        }}
                      >
                        {reversingCatalogAction ? "Reversing..." : `Reverse ${previousCatalogAction.action}`}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })()
        )}
      </div>
    </section>
  );
}
