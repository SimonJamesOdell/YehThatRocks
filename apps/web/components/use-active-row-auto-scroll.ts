"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

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
  // Captures the overlay's scrollTop synchronously before each browser paint
  // so we can restore it if something resets it to 0.
  const capturedScrollTopRef = useRef<number>(0);

  // Capture the overlay scroll position synchronously after each React commit
  // (before the browser paints) whenever the active video changes.
  useLayoutEffect(() => {
    const overlay = overlayScrollContainerRef?.current;
    capturedScrollTopRef.current = overlay?.scrollTop ?? 0;
  }, [activeVideoId, overlayScrollContainerRef]);

  useEffect(() => {
    if (!activeVideoId || isLoading || visibleVideoCount === 0) {
      return;
    }

    if (lastAutoScrolledActiveVideoIdRef.current === activeVideoId) {
      return;
    }

    // If a subsequent effect reset scrollTop to 0 after paint, restore it via rAF
    // before the next frame so the user does not see a flash to the top.
    const captured = capturedScrollTopRef.current;
    let restoreRafId: number | null = null;
    if (captured > 1) {
      restoreRafId = window.requestAnimationFrame(() => {
        restoreRafId = null;
        const overlayForRestore = overlayScrollContainerRef?.current;
        if (overlayForRestore && overlayForRestore.scrollTop === 0) {
          overlayForRestore.scrollTop = captured;
        }
      });
    }

    const timeoutId = window.setTimeout(() => {
      const overlayContainer = overlayScrollContainerRef?.current;
      const scrollContainer = overlayContainer ?? document.scrollingElement as HTMLElement | null;
      if (!scrollContainer) {
        return;
      }

      // Belt-and-suspenders: if scrollTop is still 0 after the rAF restore pass,
      // use the captured value so animation starts from the correct position.
      if (scrollContainer.scrollTop === 0 && captured > 1) {
        scrollContainer.scrollTop = captured;
      }

      const activeRow = document.querySelector<HTMLElement>(".trackCard.top100CardActive");
      if (!activeRow) {
        return;
      }

      const topGutterPx = 70;
      const containerRect = scrollContainer.getBoundingClientRect();
      const rowRect = activeRow.getBoundingClientRect();
      const rowOffsetInContent = scrollContainer.scrollTop + (rowRect.top - containerRect.top);
      const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      const targetTop = Math.min(maxScrollTop, Math.max(0, rowOffsetInContent - topGutterPx));

      if (Math.abs(scrollContainer.scrollTop - targetTop) <= 1) {
        lastAutoScrolledActiveVideoIdRef.current = activeVideoId;
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
        lastAutoScrolledActiveVideoIdRef.current = activeVideoId;
      };

      activeTrackAutoScrollRafRef.current = window.requestAnimationFrame(animateScroll);
    }, 50);

    return () => {
      if (restoreRafId !== null) {
        window.cancelAnimationFrame(restoreRafId);
      }
      window.clearTimeout(timeoutId);
      if (activeTrackAutoScrollRafRef.current !== null) {
        window.cancelAnimationFrame(activeTrackAutoScrollRafRef.current);
        activeTrackAutoScrollRafRef.current = null;
      }
    };
  }, [activeVideoId, isLoading, overlayScrollContainerRef, visibleVideoCount]);
}
