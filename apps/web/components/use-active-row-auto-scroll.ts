"use client";

import { useEffect, useRef, type RefObject } from "react";

type UseActiveRowAutoScrollOptions = {
  activeVideoId: string | null;
  isLoading: boolean;
  visibleVideoCount: number;
  overlayScrollContainerRef: RefObject<HTMLElement | null> | null;
};

export function useActiveRowAutoScroll({
  activeVideoId,
  isLoading,
  visibleVideoCount,
  overlayScrollContainerRef,
}: UseActiveRowAutoScrollOptions) {
  const activeTrackAutoScrollRafRef = useRef<number | null>(null);
  const activeTrackAutoScrollTimeoutRef = useRef<number | null>(null);
  const lastAutoScrolledActiveVideoIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeVideoId || isLoading || visibleVideoCount === 0) {
      return;
    }

    if (lastAutoScrolledActiveVideoIdRef.current === activeVideoId) {
      return;
    }

    const clearScheduledScrollWork = () => {
      if (activeTrackAutoScrollTimeoutRef.current !== null) {
        window.clearTimeout(activeTrackAutoScrollTimeoutRef.current);
        activeTrackAutoScrollTimeoutRef.current = null;
      }

      if (activeTrackAutoScrollRafRef.current !== null) {
        window.cancelAnimationFrame(activeTrackAutoScrollRafRef.current);
        activeTrackAutoScrollRafRef.current = null;
      }
    };

    let cancelled = false;
    let retryCount = 0;
    const maxRetries = 10;
    const retryDelayMs = 40;

    const attemptAutoScroll = () => {
      if (cancelled) {
        return;
      }

      const overlayContainer = overlayScrollContainerRef?.current;
      const scrollContainer = overlayContainer ?? document.scrollingElement as HTMLElement | null;
      if (!scrollContainer) {
        if (retryCount < maxRetries) {
          retryCount += 1;
          activeTrackAutoScrollTimeoutRef.current = window.setTimeout(() => {
            activeTrackAutoScrollTimeoutRef.current = null;
            attemptAutoScroll();
          }, retryDelayMs);
        }
        return;
      }

      const activeRow = document.querySelector<HTMLElement>(".trackCard.top100CardActive");
      if (!activeRow) {
        if (retryCount < maxRetries) {
          retryCount += 1;
          activeTrackAutoScrollTimeoutRef.current = window.setTimeout(() => {
            activeTrackAutoScrollTimeoutRef.current = null;
            attemptAutoScroll();
          }, retryDelayMs);
        }
        return;
      }

      const topGutterPx = 80; // Adjusted from 70 to 80 to include an additional 10px offset
      const containerRect = scrollContainer.getBoundingClientRect();
      const rowRect = activeRow.getBoundingClientRect();
      const rowOffsetInContent = scrollContainer.scrollTop + (rowRect.top - containerRect.top);
      const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      const targetTop = Math.min(maxScrollTop, Math.max(0, rowOffsetInContent - topGutterPx));

      if (Math.abs(scrollContainer.scrollTop - targetTop) <= 1) {
        lastAutoScrolledActiveVideoIdRef.current = activeVideoId;
        return;
      }

      clearScheduledScrollWork();

      const startTop = scrollContainer.scrollTop;
      const scrollDelta = targetTop - startTop;
      const durationMs = 320;
      const startTime = performance.now();

      const animateScroll = (now: number) => {
        const progress = Math.min(1, (now - startTime) / durationMs);
        const eased = 1 - ((1 - progress) ** 3);
        scrollContainer.scrollTop = startTop + (scrollDelta * eased);

        if (progress < 1) {
          activeTrackAutoScrollRafRef.current = window.requestAnimationFrame(animateScroll);
          return;
        }

        activeTrackAutoScrollRafRef.current = null;
        lastAutoScrolledActiveVideoIdRef.current = activeVideoId;
      };

      activeTrackAutoScrollRafRef.current = window.requestAnimationFrame(animateScroll);
    };

    activeTrackAutoScrollTimeoutRef.current = window.setTimeout(() => {
      activeTrackAutoScrollTimeoutRef.current = null;
      attemptAutoScroll();
    }, 50);

    return () => {
      cancelled = true;
      clearScheduledScrollWork();
    };
  }, [activeVideoId, isLoading, overlayScrollContainerRef, visibleVideoCount]);
}
