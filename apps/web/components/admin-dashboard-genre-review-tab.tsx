import { useMemo, useState, type MutableRefObject } from "react";

import type { GenreReviewVideoRow, GenreReviewWorkerState } from "@/components/admin-dashboard-types";

type AdminDashboardGenreReviewTabProps = {
  genreReviewRemaining: number;
  genreReviewCurrentVideo: GenreReviewVideoRow | null;
  genreReviewActionVideoId: string | null;
  genreReviewWorker: GenreReviewWorkerState | null;
  genreReviewPreviewIframeRef: MutableRefObject<HTMLIFrameElement | null>;
  genreReviewPreviewCurrentTimeRef: MutableRefObject<number | null>;
  onSeekGenreReviewPreview: (seconds: number) => void;
  onModerateGenreReviewVideo: (action: "approve" | "remove", genre: string | null) => Promise<void>;
};

export function AdminDashboardGenreReviewTab({
  genreReviewRemaining,
  genreReviewCurrentVideo,
  genreReviewActionVideoId,
  genreReviewWorker,
  genreReviewPreviewIframeRef,
  genreReviewPreviewCurrentTimeRef,
  onSeekGenreReviewPreview,
  onModerateGenreReviewVideo,
}: AdminDashboardGenreReviewTabProps) {
  const [draftGenre, setDraftGenre] = useState("");

  const workerProgress = useMemo(() => {
    if (!genreReviewWorker || !genreReviewWorker.totalVideos) {
      return null;
    }

    const pct = Math.max(0, Math.min(100, (genreReviewWorker.processedCount / genreReviewWorker.totalVideos) * 100));
    return `${pct.toFixed(2)}%`;
  }, [genreReviewWorker]);

  const row = genreReviewCurrentVideo;
  const baseStartAtSec = row?.durationSec && row.durationSec > 0 ? Math.floor(row.durationSec / 2) : 0;
  const maxStartAtSec = row?.durationSec && row.durationSec > 0 ? Math.max(0, row.durationSec - 1) : null;

  const effectiveDraft = draftGenre.trim().length > 0
    ? draftGenre.trim()
    : (row?.proposedGenre ?? "");

  return (
    <section className="panel featurePanel">
      <div className="panelHeading">
        <span>Genre Review Queue</span>
        <strong>{genreReviewRemaining} remaining</strong>
      </div>
      <div className="interactiveStack">
        {genreReviewWorker ? (
          <div className="authMessage" style={{ margin: 0 }}>
            <strong>Worker:</strong> {genreReviewWorker.status}
            {workerProgress ? ` | ${workerProgress}` : ""}
            {` | processed ${genreReviewWorker.processedCount}`}
            {` | updated ${genreReviewWorker.updatedCount}`}
            {` | deleted ${genreReviewWorker.deletedCount}`}
            {` | queued ${genreReviewWorker.queuedCount}`}
          </div>
        ) : null}

        {genreReviewWorker?.lastMessage ? (
          <p className="authMessage" style={{ margin: 0 }}>{genreReviewWorker.lastMessage}</p>
        ) : null}

        <p className="authMessage" style={{ margin: 0 }}>
          Tracks that cannot be classified with confidence stay here for manual review. Saving keeps the video and updates its genre.
        </p>

        {!row ? (
          <p className="authMessage">No videos pending manual genre review.</p>
        ) : (
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
              {typeof row.confidence === "number" ? (
                <p className="authMessage" style={{ margin: 0 }}>Worker confidence: {row.confidence.toFixed(3)}</p>
              ) : null}
              {row.reason ? <p className="authMessage" style={{ margin: 0 }}>Reason: {row.reason}</p> : null}
              <label style={{ display: "grid", gap: 6 }}>
                <span>Genre</span>
                <input
                  value={effectiveDraft}
                  onChange={(event) => setDraftGenre(event.target.value)}
                  placeholder={row.proposedGenre ?? "Set genre"}
                  disabled={genreReviewActionVideoId === row.videoId}
                />
              </label>
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
                  ref={genreReviewPreviewIframeRef}
                  src={`https://www.youtube.com/embed/${encodeURIComponent(row.videoId)}?rel=0&autoplay=1&mute=0&playsinline=1&enablejsapi=1&start=${baseStartAtSec}`}
                  title={`Genre review preview ${row.videoId}`}
                  loading="lazy"
                  onLoad={() => {
                    genreReviewPreviewCurrentTimeRef.current = baseStartAtSec;
                    window.setTimeout(() => {
                      onSeekGenreReviewPreview(baseStartAtSec);
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
                    const knownCurrentTime = genreReviewPreviewCurrentTimeRef.current;
                    const safeCurrentTime =
                      typeof knownCurrentTime === "number" && Number.isFinite(knownCurrentTime)
                        ? knownCurrentTime
                        : baseStartAtSec;
                    const unclampedNextStartAtSec = safeCurrentTime + 20;
                    const nextStartAtSec = maxStartAtSec === null
                      ? unclampedNextStartAtSec
                      : Math.min(unclampedNextStartAtSec, maxStartAtSec);
                    genreReviewPreviewCurrentTimeRef.current = nextStartAtSec;
                    onSeekGenreReviewPreview(nextStartAtSec);
                  }}
                  disabled={genreReviewActionVideoId === row.videoId}
                >
                  Skip +20s
                </button>

                <button
                  type="button"
                  onClick={() => {
                    void onModerateGenreReviewVideo("approve", effectiveDraft || null);
                  }}
                  disabled={genreReviewActionVideoId === row.videoId}
                >
                  Save Genre + Keep
                </button>

                <button
                  type="button"
                  onClick={() => {
                    void onModerateGenreReviewVideo("remove", null);
                  }}
                  disabled={genreReviewActionVideoId === row.videoId}
                >
                  Remove Video
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
