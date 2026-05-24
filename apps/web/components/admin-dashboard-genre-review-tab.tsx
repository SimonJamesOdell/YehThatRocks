import { useEffect, useState, type MutableRefObject } from "react";

import type { GenreReviewVideoRow } from "@/components/admin-dashboard-types";
import { TOP_LEVEL_GENRE_BUCKETS, TOP_LEVEL_GENRE_BUCKET_LABELS, resolveTopLevelGenreBucket } from "@/lib/genre-buckets";

type AdminDashboardGenreReviewTabProps = {
  genreReviewRemaining: number;
  genreReviewCurrentVideo: GenreReviewVideoRow | null;
  genreReviewActionVideoId: string | null;
  genreReviewPreviewIframeRef: MutableRefObject<HTMLIFrameElement | null>;
  genreReviewPreviewCurrentTimeRef: MutableRefObject<number | null>;
  onSeekGenreReviewPreview: (seconds: number) => void;
  onRefetchGenreReviewMetadata: () => Promise<void>;
  onReverseGenreReviewArtistTrack: () => Promise<void>;
  onAutoClassifyGenreReviewGenre: () => Promise<void>;
  onModerateGenreReviewVideo: (
    action: "approve" | "remove",
    draft: {
      genre: string | null;
      title: string;
      parsedArtist: string | null;
      parsedTrack: string | null;
    },
  ) => Promise<void>;
};

export function AdminDashboardGenreReviewTab({
  genreReviewRemaining,
  genreReviewCurrentVideo,
  genreReviewActionVideoId,
  genreReviewPreviewIframeRef,
  genreReviewPreviewCurrentTimeRef,
  onSeekGenreReviewPreview,
  onRefetchGenreReviewMetadata,
  onReverseGenreReviewArtistTrack,
  onAutoClassifyGenreReviewGenre,
  onModerateGenreReviewVideo,
}: AdminDashboardGenreReviewTabProps) {
  const [draftGenre, setDraftGenre] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftArtist, setDraftArtist] = useState("");
  const [draftTrack, setDraftTrack] = useState("");

  const genreOptions = [...TOP_LEVEL_GENRE_BUCKET_LABELS, "Unclassified"];
  const genreOptionDetails = new Map(
    TOP_LEVEL_GENRE_BUCKETS.map((bucket) => {
      const sampleTerms = bucket.terms.slice(0, 6);
      return [bucket.label, sampleTerms];
    }),
  );
  const genreSuggestions = Array.from(new Set([
    ...TOP_LEVEL_GENRE_BUCKETS.map((bucket) => bucket.label),
    ...TOP_LEVEL_GENRE_BUCKETS.flatMap((bucket) => bucket.terms),
  ]));

  useEffect(() => {
    setDraftGenre(genreReviewCurrentVideo?.proposedGenre ?? "");
    setDraftTitle(genreReviewCurrentVideo?.title ?? "");
    setDraftArtist(genreReviewCurrentVideo?.parsedArtist ?? "");
    setDraftTrack(genreReviewCurrentVideo?.parsedTrack ?? "");
  }, [
    genreReviewCurrentVideo?.videoId,
    genreReviewCurrentVideo?.proposedGenre,
    genreReviewCurrentVideo?.title,
    genreReviewCurrentVideo?.parsedArtist,
    genreReviewCurrentVideo?.parsedTrack,
  ]);

  const row = genreReviewCurrentVideo;
  const baseStartAtSec = row?.durationSec && row.durationSec > 0 ? Math.floor(row.durationSec / 2) : 0;
  const maxStartAtSec = row?.durationSec && row.durationSec > 0 ? Math.max(0, row.durationSec - 1) : null;
  const normalizedTypedGenre = draftGenre.trim().toLowerCase();
  const filteredGenreSuggestions = genreSuggestions.filter((suggestion) => {
    if (!normalizedTypedGenre) {
      return false;
    }

    return suggestion.toLowerCase().startsWith(normalizedTypedGenre);
  });
  const selectedGenreOption = resolveTopLevelGenreBucket(draftGenre) ?? "Unclassified";

  return (
    <section className="panel featurePanel">
      <div className="panelHeading">
        <span>Genre Review Queue</span>
        <strong>{genreReviewRemaining} remaining</strong>
      </div>
      <div className="interactiveStack">
        {!row ? (
          <p className="authMessage">No videos pending manual genre review.</p>
        ) : (
          <div
            className="authForm authFormWide"
            style={{
              width: "100%",
              maxWidth: "none",
              gridTemplateColumns: "65% 35%",
              gap: 12,
              alignItems: "start",
            }}
          >
            <div style={{ display: "grid", gap: 6 }}>
              <p className="authMessage" style={{ margin: 0 }}><strong>{row.videoId}</strong></p>
              <div style={{ display: "grid", gridTemplateColumns: "170px minmax(0, 1fr)", alignItems: "center", gap: 6 }}>
                <label htmlFor={`genre-review-title-${row.id}`}>Title</label>
                <input
                  id={`genre-review-title-${row.id}`}
                  style={{ padding: "5px 8px" }}
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  placeholder="Video title"
                  disabled={genreReviewActionVideoId === row.videoId}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "170px minmax(0, 1fr)", alignItems: "center", gap: 6 }}>
                <label htmlFor={`genre-review-artist-${row.id}`}>Artist (optional override)</label>
                <input
                  id={`genre-review-artist-${row.id}`}
                  style={{ padding: "5px 8px" }}
                  value={draftArtist}
                  onChange={(event) => setDraftArtist(event.target.value)}
                  placeholder="Artist"
                  disabled={genreReviewActionVideoId === row.videoId}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "170px minmax(0, 1fr)", alignItems: "center", gap: 6 }}>
                <label htmlFor={`genre-review-track-${row.id}`}>Track (optional override)</label>
                <input
                  id={`genre-review-track-${row.id}`}
                  style={{ padding: "5px 8px" }}
                  value={draftTrack}
                  onChange={(event) => setDraftTrack(event.target.value)}
                  placeholder="Track name"
                  disabled={genreReviewActionVideoId === row.videoId}
                />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                <button
                  type="button"
                  onClick={() => {
                    void onRefetchGenreReviewMetadata();
                  }}
                  disabled={genreReviewActionVideoId === row.videoId}
                >
                  Refetch Metadata
                </button>

                <button
                  type="button"
                  onClick={() => {
                    void onReverseGenreReviewArtistTrack();
                  }}
                  disabled={genreReviewActionVideoId === row.videoId}
                >
                  Reverse Artist/Track
                </button>
              </div>
              {row.channelTitle ? <p className="authMessage" style={{ margin: 0 }}>Channel: {row.channelTitle}</p> : null}
              {typeof row.confidence === "number" ? (
                <p className="authMessage" style={{ margin: 0 }}>Worker confidence: {row.confidence.toFixed(3)}</p>
              ) : null}
              {row.reason ? <p className="authMessage" style={{ margin: 0 }}>Reason: {row.reason}</p> : null}
              <div style={{ display: "grid", gridTemplateColumns: "170px minmax(0, 1fr)", alignItems: "center", gap: 6 }}>
                <label htmlFor={`genre-review-genre-${row.id}`}>Classified Genre</label>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 6, alignItems: "center" }}>
                  <input
                    id={`genre-review-genre-${row.id}`}
                    list={`genre-review-genre-suggestions-${row.id}`}
                    style={{ padding: "5px 8px", width: "100%" }}
                    value={draftGenre}
                    onChange={(event) => setDraftGenre(event.target.value)}
                    placeholder={row.proposedGenre ?? "Set genre"}
                    disabled={genreReviewActionVideoId === row.videoId}
                  />
                  <datalist id={`genre-review-genre-suggestions-${row.id}`}>
                    {filteredGenreSuggestions.map((suggestion) => (
                      <option key={suggestion} value={suggestion} />
                    ))}
                  </datalist>
                  <button
                    type="button"
                    onClick={() => {
                      void onAutoClassifyGenreReviewGenre();
                    }}
                    disabled={genreReviewActionVideoId === row.videoId}
                  >
                    {genreReviewActionVideoId === row.videoId ? "Auto..." : "Auto"}
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
                    {genreOptions.map((genreOption) => {
                      const radioId = `genre-review-${row.id}-${genreOption.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
                      const isSelected = selectedGenreOption === genreOption;
                      const optionDetails = genreOptionDetails.get(genreOption) ?? [];
                      const rowCellPadding = genreOption === "Black and Death Metal" ? "13px 8px" : "11px 8px";

                      return (
                        <tr key={genreOption} style={{ background: isSelected ? "rgba(255,255,255,0.12)" : "transparent" }}>
                          <td style={{ width: 40, textAlign: "center", padding: rowCellPadding, borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
                            <input
                              id={radioId}
                              type="radio"
                              name={`genre-review-${row.id}`}
                              value={genreOption}
                              checked={isSelected}
                              disabled={genreReviewActionVideoId === row.videoId}
                              onChange={() => {
                                setDraftGenre(genreOption === "Unclassified" ? "" : genreOption);
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
                            title={optionDetails.join(", ") || "No specific subgenres mapped."}
                          >
                            {optionDetails.length > 0 ? (
                              optionDetails.map((detail, index) => (
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
                                    setDraftGenre(detail);
                                  }}
                                >
                                  {detail}
                                  {index < optionDetails.length - 1 ? ", " : ""}
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
                  maxWidth: 420,
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
                    const normalizedGenre = draftGenre.trim();
                    const normalizedTitle = draftTitle.trim();
                    const normalizedArtist = draftArtist.trim();
                    const normalizedTrack = draftTrack.trim();
                    void onModerateGenreReviewVideo("approve", {
                      genre: normalizedGenre.length > 0 ? normalizedGenre : null,
                      title: normalizedTitle.length > 0 ? normalizedTitle : row.title,
                      parsedArtist: normalizedArtist.length > 0 ? normalizedArtist : null,
                      parsedTrack: normalizedTrack.length > 0 ? normalizedTrack : null,
                    });
                  }}
                  disabled={genreReviewActionVideoId === row.videoId}
                >
                  Save Genre + Keep
                </button>

                <button
                  type="button"
                  onClick={() => {
                    void onModerateGenreReviewVideo("remove", {
                      genre: null,
                      title: row.title,
                      parsedArtist: row.parsedArtist,
                      parsedTrack: row.parsedTrack,
                    });
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
