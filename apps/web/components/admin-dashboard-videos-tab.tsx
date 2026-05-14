import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { PendingVideoDraft, PendingVideoRow, RecentlyApprovedVideoRow } from "@/components/admin-dashboard-types";

type AdminDashboardVideosTabProps = {
  pendingVideoTotal: number;
  videoModerationPane: "pending" | "recent";
  onSetVideoModerationPane: (pane: "pending" | "recent") => void;
  pendingVideos: PendingVideoRow[];
  pendingVideoDrafts: Record<number, PendingVideoDraft>;
  onSetPendingVideoDrafts: Dispatch<SetStateAction<Record<number, PendingVideoDraft>>>;
  pendingPreviewIframeRef: MutableRefObject<HTMLIFrameElement | null>;
  pendingPreviewCurrentTimeRef: MutableRefObject<number | null>;
  onSeekPendingPreview: (seconds: number) => void;
  onModeratePendingVideo: (row: PendingVideoRow, action: "approve" | "remove") => Promise<void>;
  moderatingVideoId: string | null;
  onSetPendingPreviewSkipOffsets: Dispatch<SetStateAction<Record<number, number>>>;
  recentlyApprovedVideos: RecentlyApprovedVideoRow[];
  revokingVideoId: string | null;
  onRevokeApprovedVideo: (videoId: string) => Promise<void>;
};

export function AdminDashboardVideosTab({
  pendingVideoTotal,
  videoModerationPane,
  onSetVideoModerationPane,
  pendingVideos,
  pendingVideoDrafts,
  onSetPendingVideoDrafts,
  pendingPreviewIframeRef,
  pendingPreviewCurrentTimeRef,
  onSeekPendingPreview,
  onModeratePendingVideo,
  moderatingVideoId,
  onSetPendingPreviewSkipOffsets,
  recentlyApprovedVideos,
  revokingVideoId,
  onRevokeApprovedVideo,
}: AdminDashboardVideosTabProps) {
  return (
    <>
      <section className="panel featurePanel">
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            className={videoModerationPane === "pending" ? "navLink navLinkActive" : "navLink"}
            onClick={() => onSetVideoModerationPane("pending")}
          >
            New Videos Pending ({pendingVideoTotal})
          </button>
          <button
            type="button"
            className={videoModerationPane === "recent" ? "navLink navLinkActive" : "navLink"}
            onClick={() => onSetVideoModerationPane("recent")}
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
                              onSetPendingVideoDrafts((current) => ({
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
                              onSetPendingVideoDrafts((current) => ({
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
                              onSetPendingVideoDrafts((current) => ({
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
                                onSeekPendingPreview(baseStartAtSec);
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
                              void onModeratePendingVideo(row, "approve");
                            }}
                            disabled={moderatingVideoId === row.videoId || editableTitle.trim().length === 0}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void onModeratePendingVideo(row, "remove");
                            }}
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

                              onSetPendingPreviewSkipOffsets((current) => {
                                return {
                                  ...current,
                                  [row.id]: appliedOffset,
                                };
                              });

                              pendingPreviewCurrentTimeRef.current = nextStartAtSec;
                              onSeekPendingPreview(nextStartAtSec);
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
                    onClick={() => {
                      void onRevokeApprovedVideo(row.videoId);
                    }}
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
  );
}
