"use client";

import { useCallback, useEffect, useRef, type MutableRefObject, type UIEvent } from "react";

type FetchEndedChoiceSets = (
  requestedCount: number,
  options?: { background?: boolean; schedulePostPrimeBatch?: boolean },
) => Promise<void>;

export function useEndedChoiceOverlayRunway({
  showEndedChoiceOverlay,
  currentVideoId,
  endedChoiceReshuffleKey,
  endedChoiceGridVideosLength,
  visibleEndedChoiceVideosLength,
  endedChoiceVideosLength,
  endedChoiceRemoteVideosLength,
  endedChoiceHideSeen,
  endedChoiceBatchSize,
  endedChoiceInitialPrefetchCount,
  endedChoiceScrollRunwayCount,
  endedChoiceUserScrolledRef,
  endedChoiceFetchingRef,
  endedChoiceHasMoreRef,
  endedChoiceSkipRef,
  endedChoiceNoProgressStreakRef,
  endedChoiceFailureStreakRef,
  endedChoiceAutoRetryBlockedUntilRef,
  endedChoicePrewarmVideoIdRef,
  endedChoicePostPrimeQueuedRef,
  setEndedChoiceAnimateCards,
  setEndedChoiceLoading,
  setEndedChoiceRemoteVideos,
  fetchEndedChoiceSets,
}: {
  showEndedChoiceOverlay: boolean;
  currentVideoId: string;
  endedChoiceReshuffleKey: number;
  endedChoiceGridVideosLength: number;
  visibleEndedChoiceVideosLength: number;
  endedChoiceVideosLength: number;
  endedChoiceRemoteVideosLength: number;
  endedChoiceHideSeen: boolean;
  endedChoiceBatchSize: number;
  endedChoiceInitialPrefetchCount: number;
  endedChoiceScrollRunwayCount: number;
  endedChoiceUserScrolledRef: MutableRefObject<boolean>;
  endedChoiceFetchingRef: MutableRefObject<boolean>;
  endedChoiceHasMoreRef: MutableRefObject<boolean>;
  endedChoiceSkipRef: MutableRefObject<number>;
  endedChoiceNoProgressStreakRef: MutableRefObject<number>;
  endedChoiceFailureStreakRef: MutableRefObject<number>;
  endedChoiceAutoRetryBlockedUntilRef: MutableRefObject<number>;
  endedChoicePrewarmVideoIdRef: MutableRefObject<string | null>;
  endedChoicePostPrimeQueuedRef: MutableRefObject<boolean>;
  setEndedChoiceAnimateCards: (value: boolean) => void;
  setEndedChoiceLoading: (value: boolean) => void;
  setEndedChoiceRemoteVideos: (videos: []) => void;
  fetchEndedChoiceSets: FetchEndedChoiceSets;
}) {
  const endedChoiceOverlayRef = useRef<HTMLDivElement | null>(null);
  const endedChoicePrefetchRafRef = useRef<number | null>(null);
  const endedChoiceRowHeightRef = useRef(220);

  const getEndedChoiceColumns = useCallback(() => {
    const width = endedChoiceOverlayRef.current?.clientWidth ?? window.innerWidth;
    if (width <= 640) {
      return 1;
    }

    if (width <= 920) {
      return 2;
    }

    return 4;
  }, []);

  const estimateEndedChoiceVisibleCount = useCallback(() => {
    const overlay = endedChoiceOverlayRef.current;
    const columns = Math.max(1, getEndedChoiceColumns());

    if (!overlay) {
      return columns * 2;
    }

    const rowHeight = Math.max(1, endedChoiceRowHeightRef.current);
    const rowsVisible = Math.max(1, Math.ceil(overlay.clientHeight / rowHeight) + 1);
    return rowsVisible * columns;
  }, [getEndedChoiceColumns]);

  const measureEndedChoiceCard = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      return;
    }

    const next = node.offsetHeight + 12;
    if (next > 0) {
      endedChoiceRowHeightRef.current = next;
    }
  }, []);

  const computeCurrentEndedChoiceFirstVisibleIndex = useCallback(() => {
    const overlay = endedChoiceOverlayRef.current;
    if (!overlay) {
      return 0;
    }

    const columns = Math.max(1, getEndedChoiceColumns());
    const rowHeight = Math.max(1, endedChoiceRowHeightRef.current);
    const rowsScrolled = Math.max(0, Math.floor(overlay.scrollTop / rowHeight));
    return Math.max(0, rowsScrolled * columns);
  }, [getEndedChoiceColumns]);

  const scheduleEndedChoicePrefetchCheck = useCallback(() => {
    if (endedChoicePrefetchRafRef.current !== null) {
      return;
    }

    endedChoicePrefetchRafRef.current = window.requestAnimationFrame(() => {
      endedChoicePrefetchRafRef.current = null;

      if (!showEndedChoiceOverlay || !endedChoiceUserScrolledRef.current) {
        return;
      }

      const firstVisibleIndex = computeCurrentEndedChoiceFirstVisibleIndex();
      const visibleCount = estimateEndedChoiceVisibleCount();
      const currentRunway = endedChoiceGridVideosLength - (firstVisibleIndex + visibleCount);

      if (currentRunway < endedChoiceScrollRunwayCount) {
        void fetchEndedChoiceSets(endedChoiceBatchSize, { background: true });
      }
    });
  }, [
    computeCurrentEndedChoiceFirstVisibleIndex,
    endedChoiceBatchSize,
    endedChoiceGridVideosLength,
    endedChoiceScrollRunwayCount,
    endedChoiceUserScrolledRef,
    estimateEndedChoiceVisibleCount,
    fetchEndedChoiceSets,
    showEndedChoiceOverlay,
  ]);

  const handleEndedChoiceOverlayScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (!endedChoiceUserScrolledRef.current && event.currentTarget.scrollTop > 0) {
      endedChoiceUserScrolledRef.current = true;
      setEndedChoiceAnimateCards(false);
    }

    scheduleEndedChoicePrefetchCheck();
  }, [endedChoiceUserScrolledRef, scheduleEndedChoicePrefetchCheck, setEndedChoiceAnimateCards]);

  const shouldAutoPrimeEndedChoiceRunway = useCallback(() => {
    if (
      !showEndedChoiceOverlay
      || endedChoiceUserScrolledRef.current
      || endedChoiceFetchingRef.current
      || !endedChoiceHasMoreRef.current
    ) {
      return false;
    }

    const overlay = endedChoiceOverlayRef.current;
    const isScrollable = overlay ? overlay.scrollHeight > overlay.clientHeight + 4 : false;
    const visibleCount = estimateEndedChoiceVisibleCount();
    const lowRunway = endedChoiceGridVideosLength < visibleCount + endedChoiceScrollRunwayCount;

    const needsSeenRowFill = endedChoiceHideSeen
      && (visibleEndedChoiceVideosLength === 0 || visibleEndedChoiceVideosLength % 4 !== 0);

    return needsSeenRowFill || (!isScrollable && lowRunway);
  }, [
    endedChoiceFetchingRef,
    endedChoiceGridVideosLength,
    endedChoiceHasMoreRef,
    endedChoiceHideSeen,
    endedChoiceScrollRunwayCount,
    endedChoiceUserScrolledRef,
    estimateEndedChoiceVisibleCount,
    showEndedChoiceOverlay,
    visibleEndedChoiceVideosLength,
  ]);

  useEffect(() => {
    return () => {
      if (endedChoicePrefetchRafRef.current !== null) {
        window.cancelAnimationFrame(endedChoicePrefetchRafRef.current);
        endedChoicePrefetchRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!showEndedChoiceOverlay) {
      return;
    }

    endedChoiceUserScrolledRef.current = false;

    const hasPrewarmedChoices =
      endedChoiceReshuffleKey === 0
      && endedChoicePrewarmVideoIdRef.current === currentVideoId
      && endedChoiceRemoteVideosLength > 0;

    if (hasPrewarmedChoices) {
      setEndedChoiceLoading(false);

      if (!endedChoicePostPrimeQueuedRef.current && endedChoiceHasMoreRef.current) {
        endedChoicePostPrimeQueuedRef.current = true;
        void fetchEndedChoiceSets(endedChoiceBatchSize, { background: true });
      }

      return;
    }

    setEndedChoiceAnimateCards(true);
    endedChoiceHasMoreRef.current = true;
    endedChoiceSkipRef.current = 0;
    endedChoiceNoProgressStreakRef.current = 0;
    endedChoiceFailureStreakRef.current = 0;
    endedChoiceAutoRetryBlockedUntilRef.current = 0;
    endedChoicePostPrimeQueuedRef.current = false;
    setEndedChoiceRemoteVideos([]);
    void fetchEndedChoiceSets(endedChoiceInitialPrefetchCount, {
      schedulePostPrimeBatch: true,
    });
  }, [
    currentVideoId,
    endedChoiceAutoRetryBlockedUntilRef,
    endedChoiceBatchSize,
    endedChoiceFailureStreakRef,
    endedChoiceHasMoreRef,
    endedChoiceInitialPrefetchCount,
    endedChoiceNoProgressStreakRef,
    endedChoicePostPrimeQueuedRef,
    endedChoicePrewarmVideoIdRef,
    endedChoiceRemoteVideosLength,
    endedChoiceReshuffleKey,
    endedChoiceSkipRef,
    endedChoiceUserScrolledRef,
    fetchEndedChoiceSets,
    setEndedChoiceAnimateCards,
    setEndedChoiceLoading,
    setEndedChoiceRemoteVideos,
    showEndedChoiceOverlay,
  ]);

  useEffect(() => {
    if (!shouldAutoPrimeEndedChoiceRunway()) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (!shouldAutoPrimeEndedChoiceRunway()) {
        return;
      }

      void fetchEndedChoiceSets(endedChoiceBatchSize, { background: true });
    }, 60);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    endedChoiceBatchSize,
    endedChoiceGridVideosLength,
    endedChoiceHideSeen,
    fetchEndedChoiceSets,
    shouldAutoPrimeEndedChoiceRunway,
    showEndedChoiceOverlay,
    visibleEndedChoiceVideosLength,
  ]);

  useEffect(() => {
    const needsSeenRowFill =
      visibleEndedChoiceVideosLength === 0
      || (endedChoiceHideSeen && visibleEndedChoiceVideosLength % 4 !== 0);

    if (
      !showEndedChoiceOverlay
      || !endedChoiceUserScrolledRef.current
      || !needsSeenRowFill
      || endedChoiceFetchingRef.current
      || !endedChoiceHasMoreRef.current
    ) {
      return;
    }

    scheduleEndedChoicePrefetchCheck();
  }, [
    endedChoiceFetchingRef,
    endedChoiceHasMoreRef,
    endedChoiceHideSeen,
    endedChoiceUserScrolledRef,
    scheduleEndedChoicePrefetchCheck,
    showEndedChoiceOverlay,
    endedChoiceVideosLength,
    visibleEndedChoiceVideosLength,
  ]);

  useEffect(() => {
    if (!showEndedChoiceOverlay || !endedChoiceUserScrolledRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      scheduleEndedChoicePrefetchCheck();
    }, 80);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    endedChoiceGridVideosLength,
    endedChoiceHideSeen,
    endedChoiceUserScrolledRef,
    scheduleEndedChoicePrefetchCheck,
    showEndedChoiceOverlay,
    visibleEndedChoiceVideosLength,
  ]);

  return {
    endedChoiceOverlayRef,
    handleEndedChoiceOverlayScroll,
    measureEndedChoiceCard,
  };
}
