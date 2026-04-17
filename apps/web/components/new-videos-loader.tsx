"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { VideoRecord } from "@/lib/catalog";
import { Top100VideoLink } from "@/components/top100-video-link";
import { CloseLink } from "@/components/close-link";
import { NewScrollReset } from "@/components/new-scroll-reset";
import { useSeenTogglePreference } from "@/components/use-seen-toggle-preference";
import {
  VIDEO_QUALITY_FLAG_REASON_LABELS,
  VIDEO_QUALITY_FLAG_REASONS,
  type VideoQualityFlagReason,
} from "@/lib/video-quality-flags";

const NEW_HIDE_SEEN_TOGGLE_KEY = "ytr-toggle-hide-seen-new";

function dedupeVideos(videos: VideoRecord[]) {
  const seen = new Set<string>();

  return videos.filter((video) => {
    if (seen.has(video.id)) {
      return false;
    }

    seen.add(video.id);
    return true;
  });
}

function filterHiddenVideos(videos: VideoRecord[], hiddenVideoIdSet: Set<string>) {
  if (hiddenVideoIdSet.size === 0) {
    return videos;
  }

  return videos.filter((video) => !hiddenVideoIdSet.has(video.id));
}

export function NewVideosLoader({
  initialVideos,
  isAuthenticated,
  isAdminUser = false,
  seenVideoIds = [],
  hiddenVideoIds = [],
}: {
  initialVideos: VideoRecord[];
  isAuthenticated: boolean;
  isAdminUser?: boolean;
  seenVideoIds?: string[];
  hiddenVideoIds?: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hiddenVideoIdSet = useMemo(() => new Set(hiddenVideoIds), [hiddenVideoIds]);
  const [allVideos, setAllVideos] = useState(() => dedupeVideos(filterHiddenVideos(initialVideos, hiddenVideoIdSet)));
  const [flaggingVideo, setFlaggingVideo] = useState<VideoRecord | null>(null);
  const [flagReason, setFlagReason] = useState<VideoQualityFlagReason>("broken-playback");
  const [flagPendingVideoId, setFlagPendingVideoId] = useState<string | null>(null);
  const [flagStatus, setFlagStatus] = useState<string | null>(null);
  const [playlistStatus, setPlaylistStatus] = useState<string | null>(null);
  const [isCreatingPlaylistFromNew, setIsCreatingPlaylistFromNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hideSeen, setHideSeen] = useSeenTogglePreference({
    key: NEW_HIDE_SEEN_TOGGLE_KEY,
    isAuthenticated,
  });
  const seenVideoIdSet = useMemo(() => new Set(seenVideoIds), [seenVideoIds]);
  const visibleVideos = useMemo(
    () => (isAuthenticated && hideSeen ? allVideos.filter((v) => !seenVideoIdSet.has(v.id)) : allVideos),
    [allVideos, hideSeen, isAuthenticated, seenVideoIdSet],
  );

  const handleOpenFlagDialog = (track: VideoRecord) => {
    setFlaggingVideo(track);
    setFlagReason("broken-playback");
    setFlagStatus(null);
  };

  const handleCloseFlagDialog = () => {
    if (flagPendingVideoId) {
      return;
    }

    setFlaggingVideo(null);
    setFlagStatus(null);
  };

  const handleSubmitFlag = async () => {
    if (!flaggingVideo || flagPendingVideoId) {
      return;
    }

    setFlagPendingVideoId(flaggingVideo.id);
    setFlagStatus(null);

    try {
      const response = await fetch("/api/videos/flags", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          videoId: flaggingVideo.id,
          reason: flagReason,
        }),
      });

      if (!response.ok) {
        setFlagStatus("Could not submit flag. Please try again.");
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            actedGlobally?: boolean;
            excludedForUser?: boolean;
          }
        | null;

      if (!payload?.ok) {
        setFlagStatus("Could not submit flag. Please try again.");
        return;
      }

      setAllVideos((current) => current.filter((video) => video.id !== flaggingVideo.id));

      if (isAdminUser || payload.actedGlobally) {
        setFlagStatus("Flag recorded. This video is now excluded globally.");
      } else if (payload.excludedForUser) {
        setFlagStatus("Flag recorded. This video is now hidden for your account.");
      } else {
        setFlagStatus("Flag recorded.");
      }

      window.setTimeout(() => {
        setFlaggingVideo(null);
        setFlagStatus(null);
      }, 900);
    } catch {
      setFlagStatus("Could not submit flag. Please try again.");
    } finally {
      setFlagPendingVideoId(null);
    }
  };

  const createPlaylistFromNew = async () => {
    if (!isAuthenticated) {
      setPlaylistStatus("Sign in to create playlists.");
      return;
    }

    if (isCreatingPlaylistFromNew) {
      return;
    }

    const sourceVideos = visibleVideos;
    const videoIds = sourceVideos.map((video) => video.id).filter(Boolean);

    if (videoIds.length === 0) {
      setPlaylistStatus(hideSeen ? "No unseen New videos to add." : "No New videos to add.");
      return;
    }

    setIsCreatingPlaylistFromNew(true);
    setPlaylistStatus(null);

    const playlistName = `New ${hideSeen ? "Unseen " : ""}${new Date().toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`;

    try {
      const createResponse = await fetch("/api/playlists", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: playlistName,
          videoIds: [],
        }),
      });

      if (createResponse.status === 401 || createResponse.status === 403) {
        setPlaylistStatus("Sign in to create playlists.");
        return;
      }

      if (!createResponse.ok) {
        setPlaylistStatus("Could not create playlist from New. Please try again.");
        return;
      }

      const created = (await createResponse.json().catch(() => null)) as { id?: string; name?: string } | null;
      const createdPlaylistId = created?.id;

      if (!createdPlaylistId) {
        setPlaylistStatus("Could not create playlist from New. Please try again.");
        return;
      }

      const currentVideoId = searchParams.get("v");
      const closeHref = currentVideoId
        ? `/?v=${encodeURIComponent(currentVideoId)}&pl=${encodeURIComponent(createdPlaylistId)}&resume=1`
        : `/?pl=${encodeURIComponent(createdPlaylistId)}`;

      window.dispatchEvent(new CustomEvent("ytr:overlay-close-request", {
        detail: { href: closeHref },
      }));
      window.dispatchEvent(new CustomEvent("ytr:right-rail-mode", {
        detail: { mode: "playlist", playlistId: createdPlaylistId },
      }));
      router.push(closeHref);

      window.dispatchEvent(new CustomEvent("ytr:playlist-rail-sync", {
        detail: {
          playlist: {
            id: createdPlaylistId,
            name: playlistName,
            videos: sourceVideos,
            itemCount: sourceVideos.length,
          },
        },
      }));

      void fetch(`/api/playlists/${encodeURIComponent(createdPlaylistId)}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoIds }),
      }).then(async (addAllResponse) => {
        window.dispatchEvent(new Event("ytr:playlists-updated"));

        if (!addAllResponse.ok) {
          setPlaylistStatus("Playlist was created, but some tracks could not be saved.");
          return;
        }

        const updatedPlaylist = (await addAllResponse.json().catch(() => null)) as
          | { id?: string; videos?: VideoRecord[]; itemCount?: number; name?: string }
          | null;

        const finalVideos = Array.isArray(updatedPlaylist?.videos) ? updatedPlaylist.videos : sourceVideos;
        const finalName = updatedPlaylist?.name ?? playlistName;
        const finalItemCount = updatedPlaylist?.itemCount ?? finalVideos.length;

        window.dispatchEvent(new CustomEvent("ytr:playlist-rail-sync", {
          detail: {
            playlist: {
              id: createdPlaylistId,
              name: finalName,
              videos: finalVideos,
              itemCount: finalItemCount,
            },
          },
        }));
      }).catch(() => {
        setPlaylistStatus("Playlist was created, but tracks could not be saved.");
        window.dispatchEvent(new Event("ytr:playlists-updated"));
      });
    } catch {
      setPlaylistStatus("Could not create playlist from New. Please try again.");
    } finally {
      setIsCreatingPlaylistFromNew(false);
    }
  };

  useEffect(() => {
    const loadVideos = async () => {
      try {
        let working = dedupeVideos(filterHiddenVideos(initialVideos, hiddenVideoIdSet));

        if (working.length === 0) {
          const initialResponse = await fetch(`/api/videos/newest?skip=0&take=10`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
          });

          if (initialResponse.ok) {
            const { videos } = (await initialResponse.json()) as { videos: VideoRecord[] };
            working = dedupeVideos(filterHiddenVideos(videos, hiddenVideoIdSet));
            setAllVideos(working);
          }
        }

        const remainingTake = Math.max(0, 100 - working.length);
        if (remainingTake > 0) {
          const response = await fetch(`/api/videos/newest?skip=${working.length}&take=${remainingTake}`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
          });

          if (response.ok) {
            const { videos } = (await response.json()) as { videos: VideoRecord[] };
            setAllVideos((prev) => dedupeVideos([...prev, ...filterHiddenVideos(videos, hiddenVideoIdSet)]));
          }
        }

      } catch (error) {
        console.error("Failed to load new videos:", error);
      } finally {
        setLoading(false);
      }
    };

    void loadVideos();
  }, [hiddenVideoIdSet, initialVideos, isAuthenticated]);

  return (
    <>
      <NewScrollReset />
      <div className="favouritesBlindBar">
        <div className="newPageHeaderLeft">
          <strong><span style={{filter: "brightness(0) invert(1)"}}>⭐</span> New</strong>
          {isAuthenticated ? (
            <button
              type="button"
              className={`newPageSeenToggle${hideSeen ? " newPageSeenToggleActive" : ""}`}
              onClick={() => setHideSeen((v) => !v)}
              aria-pressed={hideSeen}
            >
              {hideSeen ? "Showing unseen only" : "Show unseen only"}
            </button>
          ) : null}
          {isAuthenticated ? (
            <button
              type="button"
              className="newPageSeenToggle top100CreatePlaylistButton"
              onClick={() => {
                void createPlaylistFromNew();
              }}
              disabled={visibleVideos.length === 0 || isCreatingPlaylistFromNew}
            >
              {isCreatingPlaylistFromNew ? "+ Creating..." : "+ New Playlist"}
            </button>
          ) : null}
        </div>
        <CloseLink />
      </div>
      {playlistStatus ? <p className="rightRailStatus">{playlistStatus}</p> : null}
      <div className="trackStack spanTwoColumns">
      {visibleVideos.map((track, index) => (
        <Top100VideoLink
          key={track.id}
          track={track}
          index={index}
          isAuthenticated={isAuthenticated}
          isSeen={seenVideoIdSet.has(track.id)}
          rowVariant="new"
          onFlagVideo={isAuthenticated ? handleOpenFlagDialog : undefined}
          isFlagPending={flagPendingVideoId === track.id}
        />
      ))}
      {loading && allVideos.length === 0 && (
        <div style={{ padding: "20px", textAlign: "center", color: "#999" }}>Loading more videos...</div>
      )}

      {flaggingVideo ? (
        <div
          className="newFlagModalBackdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Flag video quality"
          onClick={handleCloseFlagDialog}
        >
          <div className="newFlagModalPanel" onClick={(event) => event.stopPropagation()}>
            <h3>Flag Low Quality Video</h3>
            <p className="newFlagModalMeta">{flaggingVideo.title}</p>
            <label className="newFlagModalField" htmlFor="new-flag-reason">
              Reason
            </label>
            <select
              id="new-flag-reason"
              value={flagReason}
              onChange={(event) => setFlagReason(event.target.value as VideoQualityFlagReason)}
              disabled={Boolean(flagPendingVideoId)}
            >
              {VIDEO_QUALITY_FLAG_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {VIDEO_QUALITY_FLAG_REASON_LABELS[reason]}
                </option>
              ))}
            </select>

            {flagStatus ? <p className="newFlagModalStatus">{flagStatus}</p> : null}

            <div className="newFlagModalActions">
              <button type="button" onClick={handleCloseFlagDialog} disabled={Boolean(flagPendingVideoId)}>
                Cancel
              </button>
              <button type="button" onClick={() => { void handleSubmitFlag(); }} disabled={Boolean(flagPendingVideoId)}>
                {flagPendingVideoId ? "Submitting..." : "Submit flag"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
    </>
  );
}
