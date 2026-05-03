"use client";

import { useCallback, useEffect, type MutableRefObject, type RefObject } from "react";

type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

type UseNewVideosScrollPrefetchOptions = {
  loading: boolean;
  hasMore: boolean;
  overlayScrollContainerRef: RefObject<HTMLElement | null> | null;
  prefetchInFlightRef: MutableRefObject<boolean>;
  lastPrefetchAtRef: MutableRefObject<number>;
  isLoadingMoreRef: MutableRefObject<boolean>;
  hasMoreRef: MutableRefObject<boolean>;
  nextOffsetRef: MutableRefObject<number>;
  loadBatch: (skip: number, take: number) => Promise<{ received: number; added: number; failed: boolean }>;
  scrollBatchSize: number;
  scrollStartRatio: number;
  scrollPrefetchThresholdPx: number;
  scrollAggressiveStartRatio: number;
  scrollPrefetchEarlyThresholdPx: number;
  scrollTargetRunwayPx: number;
  scrollMaxPrefetchBatches: number;
};

export function useNewVideosScrollPrefetch({
  loading,
  hasMore,
  overlayScrollContainerRef,
  prefetchInFlightRef,
  lastPrefetchAtRef,
  isLoadingMoreRef,
  hasMoreRef,
  nextOffsetRef,
  loadBatch,
  scrollBatchSize,
  scrollStartRatio,
  scrollPrefetchThresholdPx,
  scrollAggressiveStartRatio,
  scrollPrefetchEarlyThresholdPx,
  scrollTargetRunwayPx,
  scrollMaxPrefetchBatches,
}: UseNewVideosScrollPrefetchOptions) {
  const readActiveScrollMetrics = useCallback((metrics?: ScrollMetrics): ScrollMetrics => {
    if (metrics) {
      return metrics;
    }

    const overlay = overlayScrollContainerRef?.current;
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
  }, [overlayScrollContainerRef]);

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
        scrollProgress >= scrollAggressiveStartRatio
        && remainingScrollablePx <= scrollPrefetchEarlyThresholdPx;

      if (scrollProgress < scrollStartRatio) {
        if (!canUseAggressivePrefetch) {
          return;
        }
      }

      if (remainingScrollablePx > scrollPrefetchThresholdPx) {
        if (!canUseAggressivePrefetch) {
          return;
        }
      }

      let batchesLoaded = 0;

      while (hasMoreRef.current && batchesLoaded < scrollMaxPrefetchBatches) {
        if (document.visibilityState !== "visible") {
          break;
        }

        const batchResult = await loadBatch(nextOffsetRef.current, scrollBatchSize);
        batchesLoaded += 1;

        if (batchResult.failed || batchResult.received === 0 || batchResult.added === 0) {
          break;
        }

        const refreshedMetrics = readActiveScrollMetrics();
        const refreshedMaxScrollablePx = Math.max(0, refreshedMetrics.scrollHeight - refreshedMetrics.clientHeight);
        if (refreshedMaxScrollablePx <= 0) {
          break;
        }

        const refreshedRemainingScrollablePx = Math.max(0, refreshedMaxScrollablePx - refreshedMetrics.scrollTop);
        if (refreshedRemainingScrollablePx >= scrollTargetRunwayPx) {
          break;
        }
      }
    } finally {
      prefetchInFlightRef.current = false;
    }
  }, [
    hasMoreRef,
    isLoadingMoreRef,
    lastPrefetchAtRef,
    loadBatch,
    loading,
    nextOffsetRef,
    prefetchInFlightRef,
    readActiveScrollMetrics,
    scrollAggressiveStartRatio,
    scrollBatchSize,
    scrollMaxPrefetchBatches,
    scrollPrefetchEarlyThresholdPx,
    scrollPrefetchThresholdPx,
    scrollStartRatio,
    scrollTargetRunwayPx,
  ]);

  useEffect(() => {
    if (loading || !hasMore) {
      return;
    }

    const overlay = overlayScrollContainerRef?.current;

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
  }, [hasMore, loading, maybeLoadMoreFromScroll, overlayScrollContainerRef]);

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
}
