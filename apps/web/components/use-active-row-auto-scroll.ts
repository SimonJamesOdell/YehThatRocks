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
  const lastAutoScrolledActiveVideoIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeVideoId || isLoading || visibleVideoCount === 0) {
      return;
    }

    if (lastAutoScrolledActiveVideoIdRef.current === activeVideoId) {
      return;
    }

    // Mark immediately so incidental rerenders (e.g. list bookkeeping updates)
    // do not restart this scroll operation for the same active id.
    lastAutoScrolledActiveVideoIdRef.current = activeVideoId;

    const timeoutId = window.setTimeout(() => {
      const overlayContainer = overlayScrollContainerRef?.current;
      const scrollContainer = overlayContainer ?? document.scrollingElement as HTMLElement | null;
      if (!scrollContainer) {
        return;
      }

      const activeRow = document.querySelector<HTMLElement>(".trackCard.top100CardActive");
      if (!activeRow) {
        return;
      }

      const topGutterPx = 80; // Adjusted from 70 to 80 to include an additional 10px offset
      const containerRect = scrollContainer.getBoundingClientRect();
      const rowRect = activeRow.getBoundingClientRect();
      const rowOffsetInContent = scrollContainer.scrollTop + (rowRect.top - containerRect.top);
      const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      const targetTop = Math.min(maxScrollTop, Math.max(0, rowOffsetInContent - topGutterPx));

      if (Math.abs(scrollContainer.scrollTop - targetTop) <= 1) {
        return;
      }

      if (activeTrackAutoScrollRafRef.current !== null) {
        window.cancelAnimationFrame(activeTrackAutoScrollRafRef.current);
        activeTrackAutoScrollRafRef.current = null;
      }

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
      };

      activeTrackAutoScrollRafRef.current = window.requestAnimationFrame(animateScroll);
    }, 50);

    return () => {
      window.clearTimeout(timeoutId);
      if (activeTrackAutoScrollRafRef.current !== null) {
        window.cancelAnimationFrame(activeTrackAutoScrollRafRef.current);
        activeTrackAutoScrollRafRef.current = null;
      }
    };
  }, [activeVideoId, isLoading, overlayScrollContainerRef, visibleVideoCount]);
}
