"use client";

import { useEffect, useRef, type RefObject } from "react";

type UseActiveRowAutoScrollOptions = {
  activeVideoId: string | null;
  isLoading: boolean;
  visibleVideoCount: number;
  overlayScrollContainerRef: RefObject<HTMLElement | null> | null;
};

const ACTIVE_ROW_SELECTOR = ".trackCard.top100CardActive";
const INITIAL_DELAY_MS = 60;
const GUTTER_PX = 80;
const SCROLL_DURATION_MS = 320;
// Retry with exponential backoff: starts at 80ms, doubles each attempt, max 30 attempts
// → total retry window: ~80+160+320+640+1280+... ≈ 2+ minutes (far more than needed)
const MAX_RETRIES = 30;
const BASE_RETRY_DELAY_MS = 80;

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
    // Don't attempt scroll while loading or when no videos are visible.
    if (!activeVideoId || isLoading || visibleVideoCount === 0) {
      return;
    }

    // Already scrolled for this exact video — skip.
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

    const performScroll = (activeRow: HTMLElement) => {
      if (cancelled) return;

      const overlayContainer = overlayScrollContainerRef?.current;
      const scrollContainer = overlayContainer ?? (document.scrollingElement as HTMLElement | null);
      if (!scrollContainer) return;

      const containerRect = scrollContainer.getBoundingClientRect();
      const rowRect = activeRow.getBoundingClientRect();
      const rowOffsetInContent = scrollContainer.scrollTop + (rowRect.top - containerRect.top);
      const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      const targetTop = Math.min(maxScrollTop, Math.max(0, rowOffsetInContent - GUTTER_PX));

      // Already at the target position — mark as done.
      if (Math.abs(scrollContainer.scrollTop - targetTop) <= 1) {
        lastAutoScrolledActiveVideoIdRef.current = activeVideoId;
        return;
      }

      clearScheduledScrollWork();

      const startTop = scrollContainer.scrollTop;
      const scrollDelta = targetTop - startTop;
      const startTime = performance.now();

      const animateScroll = (now: number) => {
        if (cancelled) return;
        const progress = Math.min(1, (now - startTime) / SCROLL_DURATION_MS);
        const eased = 1 - (1 - progress) ** 3;
        scrollContainer.scrollTop = startTop + scrollDelta * eased;

        if (progress < 1) {
          activeTrackAutoScrollRafRef.current = window.requestAnimationFrame(animateScroll);
          return;
        }

        activeTrackAutoScrollRafRef.current = null;
        lastAutoScrolledActiveVideoIdRef.current = activeVideoId;
      };

      activeTrackAutoScrollRafRef.current = window.requestAnimationFrame(animateScroll);
    };

    const attemptScroll = () => {
      if (cancelled) return;

      const overlayContainer = overlayScrollContainerRef?.current;
      const scrollContainer = overlayContainer ?? (document.scrollingElement as HTMLElement | null);

      // If the scroll container isn't ready yet, retry with backoff.
      if (!scrollContainer) {
        scheduleRetry();
        return;
      }

      const activeRow = document.querySelector<HTMLElement>(ACTIVE_ROW_SELECTOR);
      if (!activeRow) {
        scheduleRetry();
        return;
      }

      performScroll(activeRow);
    };

    const scheduleRetry = () => {
      if (cancelled || retryCount >= MAX_RETRIES) return;
      const delay = Math.min(BASE_RETRY_DELAY_MS * 2 ** retryCount, 5000);
      retryCount += 1;
      activeTrackAutoScrollTimeoutRef.current = window.setTimeout(() => {
        activeTrackAutoScrollTimeoutRef.current = null;
        attemptScroll();
      }, delay);
    };

    // Initial attempt after a short delay to allow React to commit DOM updates.
    activeTrackAutoScrollTimeoutRef.current = window.setTimeout(() => {
      activeTrackAutoScrollTimeoutRef.current = null;
      attemptScroll();
    }, INITIAL_DELAY_MS);

    return () => {
      cancelled = true;
      clearScheduledScrollWork();
    };
  }, [activeVideoId, isLoading, overlayScrollContainerRef, visibleVideoCount]);
}
