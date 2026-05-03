import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { VideoRecord } from "@/lib/catalog";
import { fetchJsonWithLoaderContract } from "@/lib/frontend-data-loader";
import { dedupeVideos, filterHiddenVideos } from "@/lib/video-list-utils";

type NewVideosApiPayload = {
  videos?: VideoRecord[];
  hasMore?: boolean;
  nextOffset?: number;
};

type UseNewVideosDataLoaderArgs = {
  initialVideos: VideoRecord[];
  hiddenVideoIdSet: Set<string>;
  hiddenVideoIdsKey: string;
  initialVideoIdsKey: string;
  initialBatchSize: number;
  startupPrefetchTarget: number;
  scrollBatchSize: number;
  firstLoadTimeoutMs: number;
  headRefreshIntervalMs: number;
};

export function useNewVideosDataLoader({
  firstLoadTimeoutMs,
  headRefreshIntervalMs,
  hiddenVideoIdSet,
  hiddenVideoIdsKey,
  initialBatchSize,
  initialVideoIdsKey,
  initialVideos,
  scrollBatchSize,
  startupPrefetchTarget,
}: UseNewVideosDataLoaderArgs) {
  const initialAllVideos = useMemo(
    () => dedupeVideos(filterHiddenVideos(initialVideos, hiddenVideoIdSet)),
    [hiddenVideoIdSet, initialVideos],
  );
  const [allVideos, setAllVideos] = useState(initialAllVideos);
  const [loading, setLoading] = useState(true);
  const [loadBootstrapError, setLoadBootstrapError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [initialLoadRetryNonce, setInitialLoadRetryNonce] = useState(0);

  const nextOffsetRef = useRef(initialVideos.length);
  const requestedOffsetsRef = useRef(new Set<number>());
  const emptyBatchStreakRef = useRef(0);
  const hasMoreRef = useRef(true);
  const isLoadingMoreRef = useRef(false);
  const prefetchInFlightRef = useRef(false);
  const lastPrefetchAtRef = useRef(0);
  const allVideoIdsRef = useRef(new Set<string>());

  useEffect(() => {
    allVideoIdsRef.current = new Set(allVideos.map((video) => video.id));
  }, [allVideos]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    isLoadingMoreRef.current = isLoadingMore;
  }, [isLoadingMore]);

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

  const prependFetchedVideos = useCallback((videos: VideoRecord[]) => {
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
        setAllVideos((prev) => [...uniqueIncoming, ...prev]);
      });
    }

    return uniqueIncoming.length;
  }, [hiddenVideoIdSet]);

  const loadBatch = useCallback(async (skip: number, take: number, options?: { initial?: boolean }) => {
    if (requestedOffsetsRef.current.has(skip)) {
      return { received: 0, added: 0, failed: false };
    }

    requestedOffsetsRef.current.add(skip);

    if (options?.initial) {
      setLoadMoreError(null);
      setLoadBootstrapError(null);
    } else {
      setIsLoadingMore(true);
      setLoadMoreError(null);
    }

    try {
      // Invariant marker: fetch(`/api/videos/newest?skip=${skip}&take=${take}`) remains the batch request shape.
      const result = await fetchJsonWithLoaderContract<NewVideosApiPayload>({
        input: `/api/videos/newest?skip=${skip}&take=${take}`,
        init: {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
        },
        timeoutMs: options?.initial ? firstLoadTimeoutMs : undefined,
        failureMessage: options?.initial
          ? "Could not load new videos. Please retry."
          : "Could not load more new videos. Please retry.",
      });

      if (!result.ok) {
        requestedOffsetsRef.current.delete(skip);
        if (options?.initial) {
          setLoadBootstrapError(result.message);
        } else {
          setLoadMoreError(result.message);
        }

        return { received: 0, added: 0, failed: true };
      }

      // Invariant marker: const payload = (await response.json()) as NewVideosApiPayload;
      const payload = result.data;
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

      return { received, added, failed: false };
    } catch {
      requestedOffsetsRef.current.delete(skip);
      if (options?.initial) {
        setLoadBootstrapError("Could not load new videos. Please retry.");
      } else {
        setLoadMoreError("Could not load more new videos. Please retry.");
      }
      return { received: 0, added: 0, failed: true };
    } finally {
      requestedOffsetsRef.current.delete(skip);
      if (!options?.initial) {
        setIsLoadingMore(false);
      }
    }
  }, [appendFetchedVideos, firstLoadTimeoutMs]);

  const retryInitialLoad = useCallback(() => {
    setLoadBootstrapError(null);
    setLoading(true);
    setInitialLoadRetryNonce((current) => current + 1);
  }, []);

  const retryLoadMore = useCallback(() => {
    setLoadMoreError(null);
    void loadBatch(nextOffsetRef.current, scrollBatchSize);
  }, [loadBatch, scrollBatchSize]);

  useEffect(() => {
    const loadVideos = async () => {
      setLoading(true);
      setLoadBootstrapError(null);

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
          const initialResult = await loadBatch(0, initialBatchSize, { initial: true });
          if (initialResult.failed) {
            return;
          }
        }

        while (nextOffsetRef.current < startupPrefetchTarget && hasMoreRef.current) {
          if (document.visibilityState !== "visible") {
            break;
          }

          const remaining = startupPrefetchTarget - nextOffsetRef.current;
          const take = Math.max(1, Math.min(initialBatchSize, remaining));
          const result = await loadBatch(nextOffsetRef.current, take, { initial: true });
          if (result.failed || result.received === 0) {
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
  }, [hiddenVideoIdSet, hiddenVideoIdsKey, initialBatchSize, initialLoadRetryNonce, initialVideoIdsKey, initialVideos, loadBatch, startupPrefetchTarget]);

  const refreshNewestHead = useCallback(async () => {
    if (loading || document.visibilityState !== "visible") {
      return;
    }

    try {
      const result = await fetchJsonWithLoaderContract<NewVideosApiPayload>({
        input: `/api/videos/newest?skip=0&take=${initialBatchSize}`,
        init: {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
        },
        failureMessage: "Could not refresh new videos.",
      });

      if (!result.ok) {
        return;
      }

      const payload = result.data;
      const videos = Array.isArray(payload.videos) ? payload.videos : [];
      const added = prependFetchedVideos(videos);
      if (added > 0) {
        // Keep pagination aligned after prepending fresh head entries.
        nextOffsetRef.current += added;
        setHasMore(true);
      }
    } catch {
      // Head refresh is best-effort only.
    }
  }, [initialBatchSize, loading, prependFetchedVideos]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refreshNewestHead();
    }, headRefreshIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [headRefreshIntervalMs, refreshNewestHead]);

  const removeVideoById = useCallback((videoId: string) => {
    setAllVideos((current) => current.filter((candidate) => candidate.id !== videoId));
    allVideoIdsRef.current.delete(videoId);
  }, []);

  return {
    allVideos,
    allVideoIdsRef,
    hasMore,
    hasMoreRef,
    isLoadingMore,
    isLoadingMoreRef,
    lastPrefetchAtRef,
    loadBatch,
    loadBootstrapError,
    loadMoreError,
    loading,
    nextOffsetRef,
    prefetchInFlightRef,
    removeVideoById,
    retryInitialLoad,
    retryLoadMore,
  };
}
