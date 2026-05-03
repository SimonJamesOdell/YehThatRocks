"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type InfiniteScrollLoadOptions = {
  background?: boolean;
};

export type InfiniteScrollLoadResult = {
  added: number;
  hasMore: boolean;
  nextOffset: number;
  errorMessage?: string;
};

type InfiniteScrollObserverTarget = {
  ref: RefObject<Element | null>;
  rootMargin: string;
  threshold?: number;
  background?: boolean;
  enabled?: boolean;
};

type UseInfiniteScrollOptions = {
  initialOffset: number;
  initialHasMore: boolean;
  fetchPage: (offset: number, options: InfiniteScrollLoadOptions) => Promise<InfiniteScrollLoadResult>;
  isEnabled?: boolean;
  isBlocked?: boolean;
  clearLoadErrorOnLoad?: boolean;
  sentinelRootMargin?: string;
  sentinelThreshold?: number;
  sentinelBackground?: boolean;
  observerTargets?: InfiniteScrollObserverTarget[];
};

const EMPTY_RESULT: InfiniteScrollLoadResult = {
  added: 0,
  hasMore: false,
  nextOffset: 0,
};

export function useInfiniteScroll({
  initialOffset,
  initialHasMore,
  fetchPage,
  isEnabled = true,
  isBlocked = false,
  clearLoadErrorOnLoad = true,
  sentinelRootMargin = "600px 0px",
  sentinelThreshold = 0,
  sentinelBackground = false,
  observerTargets = [],
}: UseInfiniteScrollOptions) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const fetchPageRef = useRef(fetchPage);
  const requestedOffsetsRef = useRef(new Set<number>());
  const nextOffsetRef = useRef(initialOffset);
  const hasMoreRef = useRef(initialHasMore);

  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoading, setIsLoading] = useState(false);
  const [isBackgroundLoading, setIsBackgroundLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchPageRef.current = fetchPage;
  }, [fetchPage]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  const resetPagination = useCallback((next: { offset: number; hasMore: boolean }) => {
    nextOffsetRef.current = next.offset;
    requestedOffsetsRef.current.clear();
    hasMoreRef.current = next.hasMore;
    setHasMore(next.hasMore);
  }, []);

  const loadMore = useCallback(async (options?: InfiniteScrollLoadOptions) => {
    if (!isEnabled || isBlocked || !hasMoreRef.current) {
      return {
        ...EMPTY_RESULT,
        hasMore: hasMoreRef.current,
        nextOffset: nextOffsetRef.current,
      };
    }

    const offset = nextOffsetRef.current;

    if (requestedOffsetsRef.current.has(offset)) {
      return {
        ...EMPTY_RESULT,
        hasMore: hasMoreRef.current,
        nextOffset: nextOffsetRef.current,
      };
    }

    requestedOffsetsRef.current.add(offset);

    const isBackground = options?.background === true;

    if (isBackground) {
      setIsBackgroundLoading(true);
    } else {
      setIsLoading(true);
      if (clearLoadErrorOnLoad) {
        setLoadError(null);
      }
    }

    try {
      const result = await fetchPageRef.current(offset, options ?? {});

      if (result.errorMessage) {
        requestedOffsetsRef.current.delete(offset);
        setLoadError(result.errorMessage);
        return {
          added: 0,
          hasMore: hasMoreRef.current,
          nextOffset: nextOffsetRef.current,
          errorMessage: result.errorMessage,
        };
      }

      const nextOffset = Number.isFinite(result.nextOffset)
        ? result.nextOffset
        : offset;

      nextOffsetRef.current = nextOffset;
      hasMoreRef.current = result.hasMore;
      setHasMore(result.hasMore);

      return {
        added: result.added,
        hasMore: result.hasMore,
        nextOffset,
      };
    } catch {
      requestedOffsetsRef.current.delete(offset);
      const fallbackError = "Could not load more items. Please retry.";
      setLoadError(fallbackError);
      return {
        added: 0,
        hasMore: hasMoreRef.current,
        nextOffset: nextOffsetRef.current,
        errorMessage: fallbackError,
      };
    } finally {
      if (isBackground) {
        setIsBackgroundLoading(false);
      } else {
        setIsLoading(false);
      }
    }
  }, [clearLoadErrorOnLoad, isBlocked, isEnabled]);

  const retryLoadMore = useCallback(() => {
    setLoadError(null);
    void loadMore();
  }, [loadMore]);

  useEffect(() => {
    if (!isEnabled || !hasMore || isBlocked) {
      return;
    }

    const targets: InfiniteScrollObserverTarget[] = [
      {
        ref: sentinelRef,
        rootMargin: sentinelRootMargin,
        threshold: sentinelThreshold,
        background: sentinelBackground,
      },
      ...observerTargets,
    ];

    const observers: IntersectionObserver[] = [];

    for (const target of targets) {
      if (target.enabled === false) {
        continue;
      }

      const element = target.ref.current;
      if (!element) {
        continue;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry?.isIntersecting || isBlocked) {
            return;
          }

          void loadMore({ background: target.background === true });
        },
        {
          root: null,
          rootMargin: target.rootMargin,
          threshold: target.threshold ?? 0,
        },
      );

      observer.observe(element);
      observers.push(observer);
    }

    return () => {
      for (const observer of observers) {
        observer.disconnect();
      }
    };
  }, [hasMore, isBlocked, isEnabled, loadMore, observerTargets, sentinelBackground, sentinelRootMargin, sentinelThreshold]);

  return {
    hasMore,
    setHasMore,
    hasMoreRef,
    isLoading,
    isBackgroundLoading,
    loadError,
    setLoadError,
    nextOffsetRef,
    sentinelRef,
    loadMore,
    retryLoadMore,
    resetPagination,
  };
}
