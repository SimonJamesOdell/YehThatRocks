import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { PendingVideoDraft, PendingVideoRow, RecentlyApprovedVideoRow } from "@/components/admin-dashboard-types";
import { TOP_LEVEL_GENRE_BUCKETS, resolveTopLevelGenreBucket } from "@/lib/genre-buckets";

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
  autoClassifyingVideoId: string | null;
  onAutoClassifyPendingGenre: (row: PendingVideoRow) => Promise<void>;
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
  autoClassifyingVideoId,
  onAutoClassifyPendingGenre,
  onSetPendingPreviewSkipOffsets,
  recentlyApprovedVideos,
  revokingVideoId,
  onRevokeApprovedVideo,
}: AdminDashboardVideosTabProps) {
  const pendingGenreOptions = [...TOP_LEVEL_GENRE_BUCKETS.map((bucket) => bucket.label), "Unclassified"];
  const pendingGenreOptionDetails = new Map(
    TOP_LEVEL_GENRE_BUCKETS.map((bucket) => {
      const sampleTerms = bucket.terms.slice(0, 6);
      return [bucket.label, sampleTerms];
    }),
  );
  const pendingGenreSuggestions = Array.from(new Set([
    ...TOP_LEVEL_GENRE_BUCKETS.map((bucket) => bucket.label),
    ...TOP_LEVEL_GENRE_BUCKETS.flatMap((bucket) => bucket.terms),
  ]));

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
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
          <p className="authMessage" style={{ margin: 0, marginLeft: "auto" }}>
            <strong>
              {videoModerationPane === "pending"
                ? (pendingVideos[0]?.videoId ?? "")
                : (recentlyApprovedVideos[0]?.videoId ?? "")}
            </strong>
          </p>
      </div>
      {videoModerationPane === "recent" ? (
        <div className="panelHeading">
          <span>Recently Approved</span>
          <strong>last 24 hours · {recentlyApprovedVideos.length} video{recentlyApprovedVideos.length !== 1 ? "s" : ""}</strong>
        </div>
      ) : null}
      <div className="interactiveStack">
          {videoModerationPane === "pending" ? (
            <>
              {pendingVideos.length === 0 ? <p className="authMessage">No pending videos.</p> : null}
              {pendingVideos.length > 0 ? (
                (() => {
                  const row = pendingVideos[0];
                  const draft = pendingVideoDrafts[row.id];
                  const editableTitle = draft?.title ?? row.title;
                  const classifiedGenreValue = draft !== undefined
                    ? (draft.genre ?? "")
                    : (row.genre ?? "");
                  const selectedPendingGenre = resolveTopLevelGenreBucket(classifiedGenreValue) ?? "Unclassified";
                  // If a draft exists for this row (user has edited it), use the draft
                  // value even if parsedArtist/parsedTrack is null (user cleared the field).
                  // Only fall back to the server value when no draft exists yet.
                  const editableArtist = draft !== undefined ? (draft.parsedArtist ?? "") : (row.parsedArtist ?? "");
                  const editableTrack = draft !== undefined ? (draft.parsedTrack ?? "") : (row.parsedTrack ?? "");
                  const baseStartAtSec = row.durationSec && row.durationSec > 0 ? Math.floor(row.durationSec / 2) : 0;
                  const maxStartAtSec = row.durationSec && row.durationSec > 0 ? Math.max(0, row.durationSec - 1) : null;
                  const normalizedTypedGenre = classifiedGenreValue.trim().toLowerCase();
                  const filteredPendingGenreSuggestions = pendingGenreSuggestions.filter((suggestion) => {
                    if (!normalizedTypedGenre) {
                      return false;
                    }

                    return suggestion.toLowerCase().startsWith(normalizedTypedGenre);
                  });

                  return (
                    <div
                      key={`pending-${row.id}`}
                      className="authForm authFormWide"
                      style={{
                        width: "100%",
                        maxWidth: "none",
                        gridTemplateColumns: "65% 35%",
                        gap: 12,
                        alignItems: "start",
                        paddingBottom: 60,
                      }}
                    >
                      <div style={{ display: "grid", gap: 5 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "170px minmax(0, 1fr)", alignItems: "center", gap: 6 }}>
                          <label htmlFor={`pending-title-${row.id}`}>Title</label>
                          <input
                            id={`pending-title-${row.id}`}
                            style={{ padding: "5px 8px" }}
                            value={editableTitle}
                            onChange={(event) => {
                              const nextTitle = event.target.value;
                              onSetPendingVideoDrafts((current) => ({
                                ...current,
                                [row.id]: {
                                  title: nextTitle,
                                  genre: current[row.id]?.genre ?? row.genre ?? null,
                                  parsedArtist: current[row.id]?.parsedArtist ?? row.parsedArtist,
                                  parsedTrack: current[row.id]?.parsedTrack ?? row.parsedTrack,
                                },
                              }));
                            }}
                            placeholder="Video title"
                          />
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "170px minmax(0, 1fr)", alignItems: "center", gap: 6 }}>
                          <label htmlFor={`pending-artist-${row.id}`}>Artist (optional override)</label>
                          <input
                            id={`pending-artist-${row.id}`}
                            style={{ padding: "5px 8px" }}
                            value={editableArtist}
                            onChange={(event) => {
                              const nextArtist = event.target.value;
                              onSetPendingVideoDrafts((current) => ({
                                ...current,
                                [row.id]: {
                                  title: current[row.id]?.title ?? row.title,
                                  genre: current[row.id]?.genre ?? row.genre ?? null,
                                  parsedArtist: nextArtist || null,
                                  parsedTrack: current[row.id]?.parsedTrack ?? row.parsedTrack,
                                },
                              }));
                            }}
                            placeholder="Artist"
                          />
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "170px minmax(0, 1fr)", alignItems: "center", gap: 6 }}>
                          <label htmlFor={`pending-track-${row.id}`}>Track (optional override)</label>
                          <input
                            id={`pending-track-${row.id}`}
                            style={{ padding: "5px 8px" }}
                            value={editableTrack}
                            onChange={(event) => {
                              const nextTrack = event.target.value;
                              onSetPendingVideoDrafts((current) => ({
                                ...current,
                                [row.id]: {
                                  title: current[row.id]?.title ?? row.title,
                                  genre: current[row.id]?.genre ?? row.genre ?? null,
                                  parsedArtist: current[row.id]?.parsedArtist ?? row.parsedArtist,
                                  parsedTrack: nextTrack || null,
                                },
                              }));
                            }}
                            placeholder="Track name"
                          />
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "170px minmax(0, 1fr)", alignItems: "center", gap: 6 }}>
                          <label htmlFor={`pending-genre-${row.id}`}>Classified Genre</label>
                          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 6, alignItems: "center" }}>
                            <input
                              id={`pending-genre-${row.id}`}
                              list={`pending-genre-suggestions-${row.id}`}
                              style={{ padding: "5px 8px" }}
                              value={classifiedGenreValue}
                              onChange={(event) => {
                                const nextGenre = event.target.value;
                                onSetPendingVideoDrafts((current) => ({
                                  ...current,
                                  [row.id]: {
                                    title: current[row.id]?.title ?? row.title,
                                    genre: nextGenre,
                                    parsedArtist: current[row.id]?.parsedArtist ?? row.parsedArtist,
                                    parsedTrack: current[row.id]?.parsedTrack ?? row.parsedTrack,
                                  },
                                }));
                              }}
                              placeholder="Classified genre"
                            />
                            <datalist id={`pending-genre-suggestions-${row.id}`}>
                              {filteredPendingGenreSuggestions.map((suggestion) => (
                                <option key={suggestion} value={suggestion} />
                              ))}
                            </datalist>
                            <button
                              type="button"
                              onClick={() => {
                                void onAutoClassifyPendingGenre(row);
                              }}
                              disabled={autoClassifyingVideoId === row.videoId || moderatingVideoId === row.videoId}
                            >
                              {autoClassifyingVideoId === row.videoId ? "Auto…" : "Auto"}
                            </button>
                          </div>
                        </div>
                        <fieldset style={{ margin: 0, padding: 0, border: 0, display: "grid", gap: 4 }}>
                          <span style={{ fontWeight: 600 }}>Category</span>
                          <table
                            style={{
                              width: "100%",
                              borderCollapse: "collapse",
                              border: "1px solid rgba(255,255,255,0.16)",
                              borderRadius: 8,
                              overflow: "hidden",
                            }}
                          >
                            <tbody>
                              {pendingGenreOptions.map((genreOption) => {
                                const radioId = `pending-genre-${row.id}-${genreOption.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
                                const isSelected = selectedPendingGenre === genreOption;
                                const genreOptionDetails = pendingGenreOptionDetails.get(genreOption) ?? [];
                                const rowCellPadding = genreOption === "Black Metal" ? "13px 8px" : "11px 8px";

                                return (
                                  <tr key={genreOption} style={{ background: isSelected ? "rgba(255,255,255,0.12)" : "transparent" }}>
                                    <td style={{ width: 40, textAlign: "center", padding: rowCellPadding, borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
                                      <input
                                        id={radioId}
                                        type="radio"
                                        name={`pending-genre-${row.id}`}
                                        value={genreOption}
                                        checked={isSelected}
                                        onChange={() => {
                                          const nextGenreValue = genreOption === "Unclassified"
                                            ? ""
                                            : genreOption;
                                          onSetPendingVideoDrafts((current) => ({
                                            ...current,
                                            [row.id]: {
                                              title: current[row.id]?.title ?? row.title,
                                              genre: nextGenreValue,
                                              parsedArtist: current[row.id]?.parsedArtist ?? row.parsedArtist,
                                              parsedTrack: current[row.id]?.parsedTrack ?? row.parsedTrack,
                                            },
                                          }));
                                        }}
                                      />
                                    </td>
                                    <td style={{ padding: rowCellPadding, borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
                                      <label htmlFor={radioId} style={{ cursor: "pointer" }}>{genreOption}</label>
                                    </td>
                                    <td
                                      style={{
                                        padding: rowCellPadding,
                                        borderBottom: "1px solid rgba(255,255,255,0.12)",
                                        fontSize: "0.75rem",
                                        lineHeight: 1.3,
                                        color: "rgba(255,255,255,0.78)",
                                        overflow: "hidden",
                                        display: "-webkit-box",
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: "vertical",
                                      }}
                                      title={genreOptionDetails.join(", ") || "No specific subgenres mapped."}
                                    >
                                      {genreOptionDetails.length > 0 ? (
                                        genreOptionDetails.map((detail, index) => (
                                          <span
                                            key={`${genreOption}-${detail}`}
                                            style={{ cursor: "pointer" }}
                                            onMouseEnter={(event) => {
                                              event.currentTarget.style.textDecoration = "underline";
                                            }}
                                            onMouseLeave={(event) => {
                                              event.currentTarget.style.textDecoration = "none";
                                            }}
                                            onClick={() => {
                                              onSetPendingVideoDrafts((current) => ({
                                                ...current,
                                                [row.id]: {
                                                  title: current[row.id]?.title ?? row.title,
                                                  genre: detail,
                                                  parsedArtist: current[row.id]?.parsedArtist ?? row.parsedArtist,
                                                  parsedTrack: current[row.id]?.parsedTrack ?? row.parsedTrack,
                                                },
                                              }));
                                            }}
                                          >
                                            {detail}
                                            {index < genreOptionDetails.length - 1 ? ", " : ""}
                                          </span>
                                        ))
                                      ) : (
                                        "No specific subgenres mapped."
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </fieldset>
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
    </>
  );
}
