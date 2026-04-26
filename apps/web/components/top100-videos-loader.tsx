"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { VideoRecord } from "@/lib/catalog";
import { CloseLink } from "@/components/close-link";
import { HideVideoConfirmModal } from "@/components/hide-video-confirm-modal";
import { Top100VideoLink } from "@/components/top100-video-link";
import { useSeenTogglePreference } from "@/components/use-seen-toggle-preference";

type TopVideosPayload = {
  videos?: VideoRecord[];
};

const TOP100_SESSION_CACHE_KEY = "ytr:top100-cache-v1";
const TOP100_SESSION_CACHE_TTL_MS = 60_000;
const TOP100_HIDE_SEEN_TOGGLE_KEY = "ytr-toggle-hide-seen-top100";
const TOP100_TARGET_COUNT = 100;
const TOP100_FETCH_SOURCE_COUNT = 180;

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

function readTop100SessionCache() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(TOP100_SESSION_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as { cachedAt?: number; videos?: VideoRecord[] };
    if (!Array.isArray(parsed.videos) || !Number.isFinite(parsed.cachedAt)) {
      return null;
    }

    if (Date.now() - Number(parsed.cachedAt) > TOP100_SESSION_CACHE_TTL_MS) {
      return null;
    }

    return dedupeVideos(parsed.videos).slice(0, TOP100_TARGET_COUNT);
  } catch {
    return null;
  }
}

function readTop100SessionCacheStale() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(TOP100_SESSION_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as { videos?: VideoRecord[] };
    if (!Array.isArray(parsed.videos)) {
      return null;
    }

    return dedupeVideos(parsed.videos).slice(0, TOP100_TARGET_COUNT);
  } catch {
    return null;
  }
}

export function Top100VideosLoader({
  isAuthenticated,
  seenVideoIds = [],
  hiddenVideoIds = [],
}: {
  isAuthenticated: boolean;
  seenVideoIds?: string[];
  hiddenVideoIds?: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hiddenVideoIdSet = useMemo(() => new Set(hiddenVideoIds), [hiddenVideoIds]);
  const [videos, setVideos] = useState<VideoRecord[]>(() => filterHiddenVideos(readTop100SessionCache() ?? [], hiddenVideoIdSet));
  const [hidingVideoIds, setHidingVideoIds] = useState<string[]>([]);
  const [videoPendingHideConfirm, setVideoPendingHideConfirm] = useState<VideoRecord | null>(null);
  const [isLoading, setIsLoading] = useState(() => videos.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isCreatingPlaylistFromTop100, setIsCreatingPlaylistFromTop100] = useState(false);
  const [hideSeen, setHideSeen] = useSeenTogglePreference({
    key: TOP100_HIDE_SEEN_TOGGLE_KEY,
    isAuthenticated,
  });
  const seenVideoIdSet = useMemo(() => new Set(seenVideoIds), [seenVideoIds]);
  const visibleVideos = useMemo(
    () => (isAuthenticated && hideSeen ? videos.filter((video) => !seenVideoIdSet.has(video.id)) : videos),
    [hideSeen, isAuthenticated, seenVideoIdSet, videos],
  );
  const videoRankById = useMemo(() => {
    const rankMap = new Map<string, number>();
    videos.forEach((video, index) => {
      rankMap.set(video.id, index);
    });
    return rankMap;
  }, [videos]);

  const handleHideVideo = useCallback((track: VideoRecord) => {
    if (!isAuthenticated || hidingVideoIds.includes(track.id)) {
      return;
    }

    setVideoPendingHideConfirm(track);
  }, [hidingVideoIds, isAuthenticated]);

  const confirmHideVideo = useCallback(async () => {
    const track = videoPendingHideConfirm;

    if (!track || !isAuthenticated || hidingVideoIds.includes(track.id)) {
      return;
    }

    setVideoPendingHideConfirm(null);

    setHidingVideoIds((current) => [...current, track.id]);
    setVideos((current) => current.filter((candidate) => candidate.id !== track.id));

    try {
      await fetch("/api/hidden-videos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ videoId: track.id }),
      });
    } catch {
      // Keep card hidden even if persistence fails, matching quick-hide behavior elsewhere.
    } finally {
      setHidingVideoIds((current) => current.filter((id) => id !== track.id));
    }
  }, [hidingVideoIds, isAuthenticated, videoPendingHideConfirm]);

  const createPlaylistFromTop100 = async () => {
    if (!isAuthenticated) {
      setMessage("Sign in to create playlists.");
      return;
    }

    if (isCreatingPlaylistFromTop100) {
      return;
    }

    const sourceVideos = visibleVideos;
    const videoIds = sourceVideos.map((video) => video.id).filter(Boolean);

    if (videoIds.length === 0) {
      setMessage(hideSeen ? "No unseen Top 100 videos to add." : "No Top 100 videos to add.");
      return;
    }

    setIsCreatingPlaylistFromTop100(true);
    setMessage(null);

    const playlistName = `Top 100 ${hideSeen ? "Unseen " : ""}${new Date().toLocaleString([], {
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
        setMessage("Sign in to create playlists.");
        return;
      }

      if (!createResponse.ok) {
        setMessage("Could not create playlist from Top 100. Please try again.");
        return;
      }

      const created = (await createResponse.json().catch(() => null)) as { id?: string; name?: string } | null;
      const createdPlaylistId = created?.id;

      if (!createdPlaylistId) {
        setMessage("Could not create playlist from Top 100. Please try again.");
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

      const ANIMATED_TRACK_LIMIT = 40;
      const animatedVideos = sourceVideos.slice(0, ANIMATED_TRACK_LIMIT);
      const optimisticItemCount = sourceVideos.length;

      for (let index = 0; index < animatedVideos.length; index += 1) {
        const video = animatedVideos[index];

        window.setTimeout(() => {
          const visible = sourceVideos.slice(0, index + 1);

          window.dispatchEvent(new CustomEvent("ytr:playlist-rail-sync", {
            detail: {
              playlist: {
                id: createdPlaylistId,
                name: playlistName,
                videos: visible,
                itemCount: optimisticItemCount,
              },
              trackId: video.id,
            },
          }));

          window.dispatchEvent(new CustomEvent("ytr:right-rail-mode", {
            detail: {
              mode: "playlist",
              playlistId: createdPlaylistId,
              trackId: video.id,
            },
          }));
        }, index * 22);
      }

      const animationDoneMs = animatedVideos.length * 22 + 40;
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("ytr:playlist-rail-sync", {
          detail: {
            playlist: {
              id: createdPlaylistId,
              name: playlistName,
              videos: sourceVideos,
              itemCount: optimisticItemCount,
            },
          },
        }));
      }, animationDoneMs);

      void fetch(`/api/playlists/${encodeURIComponent(createdPlaylistId)}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoIds }),
      }).then(async (addAllResponse) => {
        if (!addAllResponse.ok) {
          setMessage("Playlist was created, but some tracks could not be saved.");
          window.dispatchEvent(new Event("ytr:playlists-updated"));
          return;
        }

        const updatedPlaylist = (await addAllResponse.json().catch(() => null)) as
          | { id?: string; videos?: VideoRecord[]; itemCount?: number; name?: string }
          | null;

        const finalVideos = Array.isArray(updatedPlaylist?.videos) ? updatedPlaylist.videos : sourceVideos;
        const finalName = updatedPlaylist?.name ?? playlistName;
        const finalItemCount = updatedPlaylist?.itemCount ?? finalVideos.length;

        const optimisticIds = sourceVideos.map((v) => v.id).join(",");
        const serverIds = finalVideos.map((v) => v.id).join(",");
        if (serverIds !== optimisticIds || finalName !== playlistName) {
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
        }

        window.dispatchEvent(new Event("ytr:playlists-updated"));

        const addedCount = finalVideos.length;
        if (addedCount < videoIds.length) {
          setMessage(`Created playlist "${finalName}" with ${addedCount}/${videoIds.length} tracks.`);
        } else {
          setMessage(`Created playlist "${finalName}" with all ${addedCount} tracks.`);
        }
      }).catch(() => {
        setMessage("Playlist was created, but tracks could not be saved.");
        window.dispatchEvent(new Event("ytr:playlists-updated"));
      });
    } catch {
      setMessage("Could not create playlist from Top 100. Please try again.");
    } finally {
      setIsCreatingPlaylistFromTop100(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const writeSessionCache = (rows: VideoRecord[]) => {
      if (typeof window === "undefined" || rows.length === 0) {
        return;
      }

      try {
        window.sessionStorage.setItem(
          TOP100_SESSION_CACHE_KEY,
          JSON.stringify({
            cachedAt: Date.now(),
            videos: rows,
          }),
        );
      } catch {
        // Ignore session storage quota issues.
      }
    };

    if (videos.length >= TOP100_TARGET_COUNT) {
      return () => {
        cancelled = true;
      };
    }

    const loadTopVideos = async () => {
      setIsLoading(true);
      setError(null);

      const tryFetch = async () => {
        const response = await fetch(`/api/videos/top?count=${TOP100_FETCH_SOURCE_COUNT}`, {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          return [] as VideoRecord[];
        }

        const payload = (await response.json()) as TopVideosPayload;
        return Array.isArray(payload.videos)
          ? dedupeVideos(filterHiddenVideos(payload.videos, hiddenVideoIdSet)).slice(0, TOP100_TARGET_COUNT)
          : [];
      };

      try {
        let received = await tryFetch();
        if (received.length === 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 1200));
          received = await tryFetch();
        }

        if (received.length === 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 1800));
          received = await tryFetch();
        }

        if (received.length > 0) {
          if (!cancelled) {
            setVideos(received);
            setIsLoading(false);
            setError(null);
          }
          writeSessionCache(received);
          return;
        }
      } catch {
        // Fall through to friendly error state.
      }

      const staleCache = filterHiddenVideos(readTop100SessionCacheStale() ?? [], hiddenVideoIdSet);
      if (!cancelled && staleCache.length > 0) {
        setVideos(staleCache);
        setMessage("Top 100 is still warming up on the server. Showing recent cached results.");
        setError(null);
        setIsLoading(false);
        return;
      }

      if (!cancelled) {
        setError("Top 100 is warming up. Please retry in a moment.");
        setIsLoading(false);
      }
    };

    void loadTopVideos();

    return () => {
      cancelled = true;
    };
  }, [hiddenVideoIdSet, videos.length]);

  if (videos.length === 0) {
    return (
      <div className="routeContractRow artistLoadingCenter" aria-live="polite" aria-busy={isLoading}>
        {isLoading ? (
          <>
            <span className="playerBootBars" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </span>
            <span>Loading top 100...</span>
          </>
        ) : (
          <span>{error ?? "Unable to load top 100 right now."}</span>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="favouritesBlindBar">
        <div className="newPageHeaderLeft">
          <strong>Top 100</strong>
          {isAuthenticated ? (
            <button
              type="button"
              className={`newPageSeenToggle${hideSeen ? " newPageSeenToggleActive" : ""}`}
              onClick={() => setHideSeen((value) => !value)}
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
                void createPlaylistFromTop100();
              }}
              disabled={visibleVideos.length === 0 || isCreatingPlaylistFromTop100}
            >
              {isCreatingPlaylistFromTop100 ? "+ Creating..." : "+ New Playlist"}
            </button>
          ) : null}
        </div>
        <CloseLink />
      </div>

      {message ? <p className="rightRailStatus">{message}</p> : null}

      <div className="trackStack spanTwoColumns">
      {visibleVideos.map((track, index) => (
        <Top100VideoLink
          key={track.id}
          track={track}
          index={videoRankById.get(track.id) ?? index}
          isAuthenticated={isAuthenticated}
          isSeen={seenVideoIdSet.has(track.id)}
          onHideVideo={handleHideVideo}
          isHidePending={hidingVideoIds.includes(track.id)}
        />
      ))}
      {visibleVideos.length === 0 ? (
        <div style={{ padding: "20px", textAlign: "center", color: "#999" }}>No unseen videos in Top 100 right now.</div>
      ) : null}
      </div>

      <HideVideoConfirmModal
        isOpen={videoPendingHideConfirm !== null}
        video={videoPendingHideConfirm}
        isPending={videoPendingHideConfirm ? hidingVideoIds.includes(videoPendingHideConfirm.id) : false}
        onCancel={() => setVideoPendingHideConfirm(null)}
        onConfirm={() => {
          void confirmHideVideo();
        }}
      />
    </>
  );
}
