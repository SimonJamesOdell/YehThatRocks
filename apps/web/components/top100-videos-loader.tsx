"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { VideoRecord } from "@/lib/catalog";
import { CloseLink } from "@/components/close-link";
import { HideVideoConfirmModal } from "@/components/hide-video-confirm-modal";
import { OverlayHeader } from "@/components/overlay-header";
import { RouteLoaderContractRow } from "@/components/route-loader-contract-row";
import { LeaderboardVideoLink } from "@/components/leaderboard-video-link";
import { useActiveRowAutoScroll } from "@/components/use-active-row-auto-scroll";
import { useOverlayScrollContainerRef } from "@/components/overlay-scroll-container-context";
import { useLiveSearchParams } from "@/components/use-live-search-params";
import { useSeenTogglePreference } from "@/components/use-seen-toggle-preference";
import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";
import { fetchJsonWithLoaderContract } from "@/lib/frontend-data-loader";
import { createPlaylistFromVideoList } from "@/lib/playlist-create-from-video-list";
import { dedupeVideos, filterHiddenVideos } from "@/lib/video-list-utils";
import { mutateHiddenVideo } from "@/lib/hidden-video-client-service";

type TopVideosPayload = {
  videos?: VideoRecord[];
};

const TOP100_SESSION_CACHE_KEY = "ytr:top100-cache-v1";
const TOP100_SESSION_CACHE_TTL_MS = 60_000;
const TOP100_HIDE_SEEN_TOGGLE_KEY = "ytr-toggle-hide-seen-top100";
const TOP100_TARGET_COUNT = 100;
const TOP100_FETCH_SOURCE_COUNT = 180;
const TOP100_FIRST_LOAD_TIMEOUT_MS = 6_500;
const TOP100_ROUTE_QUEUE_SYNC_EVENT = "ytr:new-route-queue-sync";

function readTop100SessionCache(options?: { allowStale?: boolean }) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(TOP100_SESSION_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as { cachedAt?: number; videos?: VideoRecord[] };
    if (!Array.isArray(parsed.videos)) {
      return null;
    }

    if (!options?.allowStale) {
      if (!Number.isFinite(parsed.cachedAt)) {
        return null;
      }

      if (Date.now() - Number(parsed.cachedAt) > TOP100_SESSION_CACHE_TTL_MS) {
        return null;
      }
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
  const searchParams = useLiveSearchParams();
  const activeVideoId = searchParams.get("v");
  const overlayScrollContainerRef = useOverlayScrollContainerRef();
  const hiddenVideoIdSet = useMemo(() => new Set(hiddenVideoIds), [hiddenVideoIds]);
  const [videos, setVideos] = useState<VideoRecord[]>(() => filterHiddenVideos(readTop100SessionCache() ?? [], hiddenVideoIdSet));
  const [hidingVideoIds, setHidingVideoIds] = useState<string[]>([]);
  const [videoPendingHideConfirm, setVideoPendingHideConfirm] = useState<VideoRecord | null>(null);
  const [isLoading, setIsLoading] = useState(() => videos.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isCreatingPlaylistFromTop100, setIsCreatingPlaylistFromTop100] = useState(false);
  const [initialLoadRetryNonce, setInitialLoadRetryNonce] = useState(0);
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

  useActiveRowAutoScroll({
    activeVideoId,
    isLoading: isLoading,
    visibleVideoCount: visibleVideos.length,
    overlayScrollContainerRef,
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.dispatchEvent(new CustomEvent(TOP100_ROUTE_QUEUE_SYNC_EVENT, {
      detail: {
        source: "top100",
        videoIds: visibleVideos.map((video) => video.id),
      },
    }));
  }, [visibleVideos]);

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

    await mutateHiddenVideo({
      action: "hide",
      videoId: track.id,
      onOptimisticUpdate: () => {
        setHidingVideoIds((current) => [...current, track.id]);
        setVideos((current) => current.filter((candidate) => candidate.id !== track.id));
      },
      onSettled: () => {
        setHidingVideoIds((current) => current.filter((id) => id !== track.id));
      },
    });
  }, [hidingVideoIds, isAuthenticated, videoPendingHideConfirm]);

  const retryTop100Load = useCallback(() => {
    setError(null);
    setMessage(null);
    setInitialLoadRetryNonce((current) => current + 1);
  }, []);

  const createPlaylistFromTop100 = async () => {
    if (isCreatingPlaylistFromTop100) {
      return;
    }

    const sourceVideos = visibleVideos;

    setIsCreatingPlaylistFromTop100(true);

    const playlistName = `Top 100 ${hideSeen ? "Unseen " : ""}${new Date().toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`;

    try {
      await createPlaylistFromVideoList({
        isAuthenticated,
        sourceVideos,
        playlistName,
        router,
        currentVideoId: searchParams.get("v"),
        telemetryComponent: "top100-videos-loader",
        setStatus: setMessage,
        emptyMessage: hideSeen ? "No unseen Top 100 videos to add." : "No Top 100 videos to add.",
        createFailedMessage: "Could not create playlist from Top 100. Please try again.",
        optimisticMode: {
          kind: "staggered",
          reconcileOnlyWhenChanged: true,
        },
        onBuildSuccessMessage: ({ playlistName: finalName, addedCount, requestedCount }) => {
          if (addedCount < requestedCount) {
            return `Created playlist "${finalName}" with ${addedCount}/${requestedCount} tracks.`;
          }

          return `Created playlist "${finalName}" with all ${addedCount} tracks.`;
        },
      });
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
        // Invariant marker: fetch(`/api/videos/top?count=${TOP100_FETCH_SOURCE_COUNT}`) remains the source request shape.
        const result = await fetchJsonWithLoaderContract<TopVideosPayload>({
          input: `/api/videos/top?count=${TOP100_FETCH_SOURCE_COUNT}`,
          init: {
            method: "GET",
            cache: "no-store",
          },
          timeoutMs: TOP100_FIRST_LOAD_TIMEOUT_MS,
          failureMessage: "Could not load Top 100. Please retry.",
        });

        if (!result.ok) {
          return {
            failed: true,
            message: result.message,
            videos: [] as VideoRecord[],
          };
        }

        return {
          failed: false,
          message: null,
          videos: Array.isArray(result.data.videos)
            ? dedupeVideos(filterHiddenVideos(result.data.videos, hiddenVideoIdSet)).slice(0, TOP100_TARGET_COUNT)
            : [],
        };
      };

      try {
        const received = await tryFetch();

        if (received.videos.length > 0) {
          if (!cancelled) {
            setVideos(received.videos);
            setIsLoading(false);
            setError(null);
          }
          writeSessionCache(received.videos);
          return;
        }

        if (received.failed && !cancelled) {
          setError(received.message);
        }
      } catch {
        // Fall through to friendly error state.
      }

      const staleCache = filterHiddenVideos(readTop100SessionCache({ allowStale: true }) ?? [], hiddenVideoIdSet);
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
  }, [hiddenVideoIdSet, initialLoadRetryNonce, videos.length]);

  if (videos.length === 0) {
    return (
      <RouteLoaderContractRow
        className="artistLoadingCenter"
        isLoading={isLoading}
        loadingLabel="Loading top 100..."
        error={error ?? (!isLoading ? "Unable to load top 100 right now." : null)}
        onRetry={!isLoading ? retryTop100Load : null}
      />
    );
  }

  return (
    <>
      <OverlayHeader close={false}>
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
      </OverlayHeader>

      {message ? <p className="rightRailStatus">{message}</p> : null}

      <div className="trackStack spanTwoColumns">
      {visibleVideos.map((track, index) => (
        <LeaderboardVideoLink
          key={track.id}
          track={track}
          index={videoRankById.get(track.id) ?? index}
          isAuthenticated={isAuthenticated}
          isSeen={seenVideoIdSet.has(track.id)}
          isActive={track.id === activeVideoId}
          onHideVideo={handleHideVideo}
          isHidePending={hidingVideoIds.includes(track.id)}
        />
      ))}
      {visibleVideos.length === 0 ? (
        <div style={{ padding: "20px", textAlign: "center", color: "#999" }}>No unseen videos in Top 100 right now.</div>
      ) : null}
      </div>

      <RouteLoaderContractRow error={error} onRetry={error ? retryTop100Load : null} />

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
