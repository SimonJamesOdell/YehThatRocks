"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

type SuggestOutcome = {
  kind: "video" | "playlist";
  status: "ingested" | "already-in-catalog" | "rejected" | "queued";
  title: string;
  detail: string;
  videoId?: string;
  artist?: string | null;
  track?: string | null;
};

type NewVideosApiPayload = {
  videos?: VideoRecord[];
  hasMore?: boolean;
  nextOffset?: number;
};

const NEW_INITIAL_BATCH_SIZE = 12;
const NEW_STARTUP_PREFETCH_TARGET = 100;
const NEW_SCROLL_BATCH_SIZE = 10;
const NEW_SCROLL_PREFETCH_THRESHOLD_PX = 1400;
const NEW_SCROLL_START_RATIO = 0.5;
const NEW_SCROLL_AGGRESSIVE_START_RATIO = 0.35;
const NEW_SCROLL_PREFETCH_EARLY_THRESHOLD_PX = 2200;
const NEW_SCROLL_TARGET_RUNWAY_PX = 2600;
const NEW_SCROLL_MAX_PREFETCH_BATCHES = 2;
const NEW_PLAYLIST_MAX_ITEMS = 100;

type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

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

type NewVideoRowProps = {
  track: VideoRecord;
  index: number;
  isAuthenticated: boolean;
  isSeen: boolean;
  onFlagVideo?: (track: VideoRecord) => void;
  isFlagPending: boolean;
};

const NewVideoRow = memo(function NewVideoRow({
  track,
  index,
  isAuthenticated,
  isSeen,
  onFlagVideo,
  isFlagPending,
}: NewVideoRowProps) {
  return (
    <Top100VideoLink
      key={track.id}
      track={track}
      index={index}
      isAuthenticated={isAuthenticated}
      isSeen={isSeen}
      rowVariant="new"
      onFlagVideo={onFlagVideo}
      isFlagPending={isFlagPending}
    />
  );
}, (prev, next) => {
  return prev.track.id === next.track.id
    && prev.track.title === next.track.title
    && prev.track.channelTitle === next.track.channelTitle
    && prev.track.favourited === next.track.favourited
    && prev.index === next.index
    && prev.isAuthenticated === next.isAuthenticated
    && prev.isSeen === next.isSeen
    && prev.isFlagPending === next.isFlagPending
    && prev.onFlagVideo === next.onFlagVideo;
});

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
  const hiddenVideoIdsKey = useMemo(() => [...hiddenVideoIds].sort().join("|"), [hiddenVideoIds]);
  const initialVideoIdsKey = useMemo(() => initialVideos.map((video) => video.id).join("|"), [initialVideos]);
  const hiddenVideoIdSet = useMemo(() => new Set(hiddenVideoIds), [hiddenVideoIds]);
  const [allVideos, setAllVideos] = useState(() => dedupeVideos(filterHiddenVideos(initialVideos, hiddenVideoIdSet)));
  const [flaggingVideo, setFlaggingVideo] = useState<VideoRecord | null>(null);
  const [flagReason, setFlagReason] = useState<VideoQualityFlagReason>("broken-playback");
  const [flagPendingVideoId, setFlagPendingVideoId] = useState<string | null>(null);
  const [flagStatus, setFlagStatus] = useState<string | null>(null);
  const [playlistStatus, setPlaylistStatus] = useState<string | null>(null);
  const [isSuggestModalOpen, setIsSuggestModalOpen] = useState(false);
  const [suggestSource, setSuggestSource] = useState("");
  const [suggestArtist, setSuggestArtist] = useState("");
  const [suggestTrack, setSuggestTrack] = useState("");
  const [suggestPending, setSuggestPending] = useState(false);
  const [suggestQuotaStatusPending, setSuggestQuotaStatusPending] = useState(false);
  const [suggestQuotaExhausted, setSuggestQuotaExhausted] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestOutcome, setSuggestOutcome] = useState<SuggestOutcome | null>(null);
  const [isCreatingPlaylistFromNew, setIsCreatingPlaylistFromNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [hideSeen, setHideSeen] = useSeenTogglePreference({
    key: NEW_HIDE_SEEN_TOGGLE_KEY,
    isAuthenticated,
  });
  const nextOffsetRef = useRef(initialVideos.length);
  const requestedOffsetsRef = useRef(new Set<number>());
  const emptyBatchStreakRef = useRef(0);
  const hasMoreRef = useRef(true);
  const isLoadingMoreRef = useRef(false);
  const prefetchInFlightRef = useRef(false);
  const lastPrefetchAtRef = useRef(0);
  const allVideoIdsRef = useRef(new Set<string>());
  const seenVideoIdSet = useMemo(() => new Set(seenVideoIds), [seenVideoIds]);
  const visibleVideos = useMemo(
    () => (isAuthenticated && hideSeen ? allVideos.filter((v) => !seenVideoIdSet.has(v.id)) : allVideos),
    [allVideos, hideSeen, isAuthenticated, seenVideoIdSet],
  );

  useEffect(() => {
    allVideoIdsRef.current = new Set(allVideos.map((video) => video.id));
  }, [allVideos]);

  useEffect(() => {
    function handleCatalogDeleted(event: Event) {
      const deletedId = (event as CustomEvent<{ videoId: string }>).detail?.videoId;
      if (!deletedId) {
        return;
      }

      setAllVideos((current) => current.filter((v) => v.id !== deletedId));
      allVideoIdsRef.current.delete(deletedId);
    }

    window.addEventListener("ytr:video-catalog-deleted", handleCatalogDeleted);
    return () => window.removeEventListener("ytr:video-catalog-deleted", handleCatalogDeleted);
  }, []);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    isLoadingMoreRef.current = isLoadingMore;
  }, [isLoadingMore]);

  const handleOpenFlagDialog = useCallback((track: VideoRecord) => {
    setFlaggingVideo(track);
    setFlagReason("broken-playback");
    setFlagStatus(null);
  }, []);

  const appendFetchedVideos = useCallback((videos: VideoRecord[]) => {
    if (videos.length === 0) {
      return 0;
    }

    const filteredIncoming = filterHiddenVideos(videos, hiddenVideoIdSet);
    const uniqueIncoming = filteredIncoming.filter((video) => {
      if (!video?.id || allVideoIdsRef.current.has(video.id)) {
        return false;
      }

      allVideoIdsRef.current.add(video.id);
      return true;
    });

    if (uniqueIncoming.length > 0) {
      startTransition(() => {
        setAllVideos((prev) => [...prev, ...uniqueIncoming]);
      });
    }

    return uniqueIncoming.length;
  }, [hiddenVideoIdSet]);

  const loadBatch = useCallback(async (skip: number, take: number, options?: { initial?: boolean }) => {
    if (requestedOffsetsRef.current.has(skip)) {
      return { received: 0, added: 0 };
    }

    requestedOffsetsRef.current.add(skip);

    if (options?.initial) {
      setLoadMoreError(null);
    } else {
      setIsLoadingMore(true);
      setLoadMoreError(null);
    }

    try {
      const response = await fetch(`/api/videos/newest?skip=${skip}&take=${take}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("new-videos-load-failed");
      }

      const payload = (await response.json()) as NewVideosApiPayload;
      const videos = Array.isArray(payload.videos) ? payload.videos : [];
      const received = videos.length;
      const added = appendFetchedVideos(videos);

      const nextOffset = Number(payload.nextOffset);
      nextOffsetRef.current = Number.isFinite(nextOffset) ? nextOffset : skip + received;

      if (received === 0) {
        emptyBatchStreakRef.current += 1;
      } else {
        emptyBatchStreakRef.current = 0;
      }

      if (received === 0 && (payload.hasMore === false || emptyBatchStreakRef.current >= 2)) {
        setHasMore(false);
      } else if (received > 0) {
        // Keep advancing while server still yields rows, even if hasMore is conservative.
        setHasMore(true);
      }

      return { received, added };
    } catch {
      requestedOffsetsRef.current.delete(skip);
      if (!options?.initial) {
        setLoadMoreError("Could not load more new videos. Scroll again to retry.");
      }
      return { received: 0, added: 0 };
    } finally {
      requestedOffsetsRef.current.delete(skip);
      if (!options?.initial) {
        setIsLoadingMore(false);
      }
    }
  }, [appendFetchedVideos]);

  const readActiveScrollMetrics = useCallback((metrics?: ScrollMetrics): ScrollMetrics => {
    if (metrics) {
      return metrics;
    }

    const overlay = document.querySelector<HTMLElement>(".favouritesBlindInner");
    if (overlay && overlay.scrollHeight > overlay.clientHeight) {
      return {
        scrollTop: overlay.scrollTop,
        scrollHeight: overlay.scrollHeight,
        clientHeight: overlay.clientHeight,
      };
    }

    return {
      scrollTop: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: window.innerHeight,
    };
  }, []);

  const maybeLoadMoreFromScroll = useCallback(async (metrics?: ScrollMetrics) => {
    if (prefetchInFlightRef.current || loading || isLoadingMoreRef.current || !hasMoreRef.current) {
      return;
    }

    if (document.visibilityState !== "visible") {
      return;
    }

    const now = Date.now();
    if (now - lastPrefetchAtRef.current < 120) {
      return;
    }
    lastPrefetchAtRef.current = now;

    prefetchInFlightRef.current = true;

    try {
      const activeMetrics = readActiveScrollMetrics(metrics);
      const maxScrollablePx = Math.max(0, activeMetrics.scrollHeight - activeMetrics.clientHeight);
      if (maxScrollablePx <= 0) {
        return;
      }

      const scrollProgress = activeMetrics.scrollTop / maxScrollablePx;
      const remainingScrollablePx = Math.max(0, maxScrollablePx - activeMetrics.scrollTop);
      const canUseAggressivePrefetch =
        scrollProgress >= NEW_SCROLL_AGGRESSIVE_START_RATIO
        && remainingScrollablePx <= NEW_SCROLL_PREFETCH_EARLY_THRESHOLD_PX;

      if (scrollProgress < NEW_SCROLL_START_RATIO) {
        if (!canUseAggressivePrefetch) {
          return;
        }
      }

      if (remainingScrollablePx > NEW_SCROLL_PREFETCH_THRESHOLD_PX) {
        if (!canUseAggressivePrefetch) {
          return;
        }
      }

      let batchesLoaded = 0;

      while (hasMoreRef.current && batchesLoaded < NEW_SCROLL_MAX_PREFETCH_BATCHES) {
        if (document.visibilityState !== "visible") {
          break;
        }

        const batchResult = await loadBatch(nextOffsetRef.current, NEW_SCROLL_BATCH_SIZE);
        batchesLoaded += 1;

        if (batchResult.received === 0 || batchResult.added === 0) {
          break;
        }

        const refreshedMetrics = readActiveScrollMetrics();
        const refreshedMaxScrollablePx = Math.max(0, refreshedMetrics.scrollHeight - refreshedMetrics.clientHeight);
        if (refreshedMaxScrollablePx <= 0) {
          break;
        }

        const refreshedRemainingScrollablePx = Math.max(0, refreshedMaxScrollablePx - refreshedMetrics.scrollTop);
        if (refreshedRemainingScrollablePx >= NEW_SCROLL_TARGET_RUNWAY_PX) {
          break;
        }
      }
    } finally {
      prefetchInFlightRef.current = false;
    }
  }, [loadBatch, loading, readActiveScrollMetrics]);

  useEffect(() => {
    if (loading || !hasMore) {
      return;
    }

    const overlay = document.querySelector<HTMLElement>(".favouritesBlindInner");

    const onWindowScroll = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void maybeLoadMoreFromScroll();
    };

    const onOverlayScroll = (event: Event) => {
      if (document.visibilityState !== "visible") {
        return;
      }

      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) {
        void maybeLoadMoreFromScroll();
        return;
      }

      void maybeLoadMoreFromScroll({
        scrollTop: target.scrollTop,
        scrollHeight: target.scrollHeight,
        clientHeight: target.clientHeight,
      });
    };

    window.addEventListener("scroll", onWindowScroll, { passive: true });
    if (overlay) {
      overlay.addEventListener("scroll", onOverlayScroll, { passive: true });
    }

    return () => {
      window.removeEventListener("scroll", onWindowScroll);
      if (overlay) {
        overlay.removeEventListener("scroll", onOverlayScroll);
      }
    };
  }, [hasMore, loading, maybeLoadMoreFromScroll]);

  useEffect(() => {
    if (loading || !hasMore) {
      return;
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void maybeLoadMoreFromScroll();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [hasMore, loading, maybeLoadMoreFromScroll]);

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

    const sourceVideos = visibleVideos.slice(0, NEW_PLAYLIST_MAX_ITEMS);
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

  const closeSuggestModal = () => {
    if (suggestPending) {
      return;
    }

    setIsSuggestModalOpen(false);
    setSuggestError(null);
    setSuggestOutcome(null);
  };

  const refreshSuggestQuotaStatus = async () => {
    if (!isAuthenticated) {
      setSuggestQuotaExhausted(false);
      return;
    }

    setSuggestQuotaStatusPending(true);

    try {
      const response = await fetch("/api/videos/suggest", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            quotaExhausted?: boolean;
          }
        | null;

      if (response.ok && payload?.ok) {
        setSuggestQuotaExhausted(Boolean(payload.quotaExhausted));
      }
    } catch {
      // Best effort status check only.
    } finally {
      setSuggestQuotaStatusPending(false);
    }
  };

  const resetSuggestForAnother = () => {
    setSuggestSource("");
    setSuggestArtist("");
    setSuggestTrack("");
    setSuggestError(null);
    setSuggestOutcome(null);

    if (suggestQuotaExhausted) {
      return;
    }
  };

  const watchSuggestedVideoNow = () => {
    if (!suggestOutcome?.videoId) {
      return;
    }

    const href = `/?v=${encodeURIComponent(suggestOutcome.videoId)}&resume=1`;
    window.dispatchEvent(new CustomEvent("ytr:overlay-close-request", {
      detail: { href },
    }));
    router.push(href);
    closeSuggestModal();
  };

  const submitSuggestNew = async () => {
    if (!isAuthenticated) {
      setSuggestError("Sign in to suggest new videos.");
      return;
    }

    const source = suggestSource.trim();
    if (!source) {
      setSuggestError("Paste a YouTube URL, playlist URL, or video id.");
      return;
    }

    setSuggestPending(true);
    setSuggestError(null);
    setSuggestOutcome(null);

    try {
      const response = await fetch("/api/videos/suggest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source,
          artist: suggestArtist.trim() || undefined,
          track: suggestTrack.trim() || undefined,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            kind?: "video" | "playlist";
            videoId?: string;
            submissionStatus?: "ingested" | "already-in-catalog" | "rejected";
            rejectionReason?: string | null;
            artist?: string | null;
            track?: string | null;
            queuedVideoCount?: number;
            errorCode?: string;
            decision?: { message?: string };
          }
        | null;

      if (!response.ok || !payload?.ok) {
        if (payload?.errorCode === "youtube-quota-exhausted") {
          setSuggestQuotaExhausted(true);
        }
        setSuggestError(payload?.error || "Could not submit suggestion. Please try again.");
        return;
      }

      if (payload.kind === "playlist") {
        setSuggestOutcome({
          kind: "playlist",
          status: "queued",
          title: "Playlist queued",
          detail: `Queued ${payload.queuedVideoCount ?? 0} videos for background ingestion.`,
        });
      } else {
        if (payload.submissionStatus === "already-in-catalog") {
          setSuggestOutcome({
            kind: "video",
            status: "already-in-catalog",
            title: "Already in catalog",
            detail: "This video already exists in the catalog and is available now.",
            videoId: payload.videoId,
            artist: payload.artist,
            track: payload.track,
          });
        } else if (payload.submissionStatus === "rejected") {
          setSuggestOutcome({
            kind: "video",
            status: "rejected",
            title: "Suggestion rejected",
            detail: payload.rejectionReason || payload.decision?.message || "Rejected during ingestion/classification.",
            videoId: payload.videoId,
          });
        } else {
          setSuggestOutcome({
            kind: "video",
            status: "ingested",
            title: "Ingestion succeeded",
            detail: "Video ingested and classified successfully.",
            videoId: payload.videoId,
            artist: payload.artist,
            track: payload.track,
          });
        }
      }
    } catch {
      setSuggestError("Could not submit suggestion. Please try again.");
    } finally {
      setSuggestPending(false);
    }
  };

  useEffect(() => {
    const loadVideos = async () => {
      try {
        const working = dedupeVideos(filterHiddenVideos(initialVideos, hiddenVideoIdSet));
        allVideoIdsRef.current = new Set(working.map((video) => video.id));
        setAllVideos(working);
        nextOffsetRef.current = working.length;
        requestedOffsetsRef.current.clear();
        emptyBatchStreakRef.current = 0;
        setHasMore(true);
        setLoadMoreError(null);

        if (working.length === 0) {
          await loadBatch(0, NEW_INITIAL_BATCH_SIZE, { initial: true });
        }

        while (nextOffsetRef.current < NEW_STARTUP_PREFETCH_TARGET && hasMoreRef.current) {
          if (document.visibilityState !== "visible") {
            break;
          }

          const remaining = NEW_STARTUP_PREFETCH_TARGET - nextOffsetRef.current;
          const take = Math.max(1, Math.min(NEW_INITIAL_BATCH_SIZE, remaining));
          const result = await loadBatch(nextOffsetRef.current, take, { initial: true });
          if (result.received === 0) {
            break;
          }
        }

      } catch (error) {
        console.error("Failed to load new videos:", error);
      } finally {
        setLoading(false);
      }
    };

    void loadVideos();
  }, [hiddenVideoIdsKey, initialVideoIdsKey, loadBatch]);

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
                setSuggestSource("");
                setSuggestArtist("");
                setSuggestTrack("");
                setSuggestOutcome(null);
                setSuggestError(null);
                setSuggestQuotaExhausted(false);
                setIsSuggestModalOpen(true);
                void refreshSuggestQuotaStatus();
              }}
            >
              + Suggest New
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
        <NewVideoRow
          key={track.id}
          track={track}
          index={index}
          isAuthenticated={isAuthenticated}
          isSeen={seenVideoIdSet.has(track.id)}
          onFlagVideo={isAuthenticated ? handleOpenFlagDialog : undefined}
          isFlagPending={flagPendingVideoId === track.id}
        />
      ))}
      {loading && allVideos.length === 0 && (
        <div className="relatedLoadingState" aria-live="polite" aria-busy="true">
          <span className="playerBootBars" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span>Loading new videos...</span>
        </div>
      )}
      {!loading && isLoadingMore ? <p className="rightRailStatus">Loading more new videos...</p> : null}
      {!loading && loadMoreError ? <p className="rightRailStatus rightRailStatusError">{loadMoreError}</p> : null}
      {!loading && !hasMore && allVideos.length > 0 ? <p className="rightRailStatus">End of new videos.</p> : null}

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
    {isSuggestModalOpen && typeof document !== "undefined"
      ? createPortal(
        <div
          className="suggestNewModalBackdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Suggest new YouTube videos"
          onClick={closeSuggestModal}
        >
          <div className="suggestNewModalPanel" onClick={(event) => event.stopPropagation()}>
            <div className="suggestNewModalHeader">
              <h3>Suggest New</h3>
              <p className="suggestNewModalMeta">Paste a YouTube video or playlist. We will ingest and classify it.</p>
            </div>

            <p className="suggestNewModalHints">
              Accepted formats: <strong>watch URLs</strong>, <strong>short URLs</strong>, <strong>video IDs</strong>, and <strong>playlist URLs</strong>.
            </p>

            {suggestQuotaExhausted ? (
              <div className="suggestNewModalResult suggestNewModalResult-rejected" role="status" aria-live="polite">
                <p className="suggestNewModalResultTitle">YouTube API credits exhausted</p>
                <p className="suggestNewModalResultDetail">
                  Suggest New is temporarily unavailable because the YouTube API daily quota is exhausted. Please try again later.
                </p>
              </div>
            ) : null}

            {!suggestQuotaExhausted ? (
              <>
            <label className="newFlagModalField suggestNewModalField" htmlFor="suggest-new-source">
              YouTube URL or Video ID
            </label>
            <input
              className="suggestNewModalInput"
              id="suggest-new-source"
              value={suggestSource}
              onChange={(event) => setSuggestSource(event.currentTarget.value)}
              placeholder="https://youtube.com/watch?v=... or https://youtube.com/playlist?list=..."
              disabled={suggestPending}
              maxLength={2048}
            />

            <div className="suggestNewModalOptionalGrid">
            <label className="newFlagModalField suggestNewModalField" htmlFor="suggest-new-artist">
              Artist (optional)
            </label>
            <input
              className="suggestNewModalInput"
              id="suggest-new-artist"
              value={suggestArtist}
              onChange={(event) => setSuggestArtist(event.currentTarget.value)}
              placeholder="Artist name"
              disabled={suggestPending}
              maxLength={255}
            />

            <label className="newFlagModalField suggestNewModalField" htmlFor="suggest-new-track">
              Track name (optional)
            </label>
            <input
              className="suggestNewModalInput"
              id="suggest-new-track"
              value={suggestTrack}
              onChange={(event) => setSuggestTrack(event.currentTarget.value)}
              placeholder="Track title"
              disabled={suggestPending}
              maxLength={255}
            />
            </div>
              </>
            ) : null}

            {suggestError ? <p className="newFlagModalStatus suggestNewModalStatus">{suggestError}</p> : null}

            {suggestOutcome ? (
              <div className={`suggestNewModalResult suggestNewModalResult-${suggestOutcome.status}`}>
                <p className="suggestNewModalResultTitle">{suggestOutcome.title}</p>
                <p className="suggestNewModalResultDetail">{suggestOutcome.detail}</p>
                {suggestOutcome.kind === "video" && suggestOutcome.status !== "rejected" ? (
                  <div className="suggestNewModalResultMeta">
                    <p><strong>Artist:</strong> {suggestOutcome.artist?.trim() || "Unknown"}</p>
                    <p><strong>Track:</strong> {suggestOutcome.track?.trim() || "Unknown"}</p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {suggestOutcome && suggestOutcome.kind === "video" && suggestOutcome.status !== "rejected" ? (
              <div className="newFlagModalActions suggestNewModalActions">
                <button type="button" onClick={resetSuggestForAnother} disabled={suggestPending}>
                  Suggest another
                </button>
                <button type="button" onClick={watchSuggestedVideoNow} disabled={suggestPending || !suggestOutcome.videoId}>
                  Watch now
                </button>
              </div>
            ) : suggestOutcome ? (
              <div className="newFlagModalActions suggestNewModalActions">
                <button type="button" onClick={closeSuggestModal} disabled={suggestPending}>
                  Close
                </button>
                <button type="button" onClick={resetSuggestForAnother} disabled={suggestPending}>
                  Suggest another
                </button>
              </div>
            ) : suggestQuotaExhausted ? (
              <div className="newFlagModalActions suggestNewModalActions">
                <button type="button" onClick={closeSuggestModal} disabled={suggestPending || suggestQuotaStatusPending}>
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void refreshSuggestQuotaStatus();
                  }}
                  disabled={suggestPending || suggestQuotaStatusPending}
                >
                  {suggestQuotaStatusPending ? "Checking..." : "Check again"}
                </button>
              </div>
            ) : (
              <div className="newFlagModalActions suggestNewModalActions">
                <button type="button" onClick={closeSuggestModal} disabled={suggestPending}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void submitSuggestNew();
                  }}
                  disabled={suggestPending}
                >
                  {suggestPending ? "Submitting..." : "Submit"}
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )
      : null}
    </>
  );
}
