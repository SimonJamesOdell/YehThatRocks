"use client";

import { useCallback, useState, type RefObject } from "react";

import {
  type InfiniteScrollLoadOptions,
  useInfiniteScroll,
} from "@/components/use-infinite-scroll";

type ObserverTarget = {
  ref: RefObject<Element | null>;
  rootMargin: string;
  threshold?: number;
  background?: boolean;
  enabled?: boolean;
};

export type InfiniteListPageResult<TItem> = {
  incoming: TItem[];
  hasMore: boolean;
  nextOffset?: number;
  errorMessage?: string;
  incomingCountForOffset?: number;
};

type UseInfiniteListControllerOptions<TItem> = {
  initialItems: TItem[];
  initialHasMore: boolean;
  initialOffset?: number;
  getItemKey: (item: TItem) => string;
  fetchPage: (
    offset: number,
    options: InfiniteScrollLoadOptions,
  ) => Promise<InfiniteListPageResult<TItem>>;
  stopOnNoUniqueIncoming?: boolean;
  isEnabled?: boolean;
  isBlocked?: boolean;
  clearLoadErrorOnLoad?: boolean;
  sentinelRootMargin?: string;
  sentinelThreshold?: number;
  sentinelBackground?: boolean;
  observerTargets?: ObserverTarget[];
};

export function useInfiniteListController<TItem>({
  initialItems,
  initialHasMore,
  initialOffset,
  getItemKey,
  fetchPage,
  stopOnNoUniqueIncoming = false,
  isEnabled,
  isBlocked,
  clearLoadErrorOnLoad,
  sentinelRootMargin,
  sentinelThreshold,
  sentinelBackground,
  observerTargets,
}: UseInfiniteListControllerOptions<TItem>) {
  const [items, setItems] = useState<TItem[]>(initialItems);

  const fetchManagedPage = useCallback(
    async (offset: number, options: InfiniteScrollLoadOptions) => {
      const page = await fetchPage(offset, options);

      if (page.errorMessage) {
        return {
          added: 0,
          hasMore: false,
          nextOffset: offset,
          errorMessage: page.errorMessage,
        };
      }

      const incoming = Array.isArray(page.incoming) ? page.incoming : [];

      let added = 0;
      setItems((current) => {
        const seen = new Set(current.map(getItemKey));
        const uniqueIncoming: TItem[] = [];

        for (const item of incoming) {
          const key = getItemKey(item);
          if (seen.has(key)) {
            continue;
          }

          seen.add(key);
          uniqueIncoming.push(item);
        }

        added = uniqueIncoming.length;
        if (added === 0) {
          return current;
        }

        return [...current, ...uniqueIncoming];
      });

      const nextOffsetValue = Number(page.nextOffset);
      const incomingCountForOffsetValue = Number(page.incomingCountForOffset);
      const fallbackIncomingCount = Number.isFinite(incomingCountForOffsetValue)
        ? incomingCountForOffsetValue
        : incoming.length;

      return {
        added,
        hasMore: stopOnNoUniqueIncoming && added === 0 ? false : page.hasMore,
        nextOffset: Number.isFinite(nextOffsetValue)
          ? nextOffsetValue
          : offset + fallbackIncomingCount,
      };
    },
    [fetchPage, getItemKey, stopOnNoUniqueIncoming],
  );

  const infinite = useInfiniteScroll({
    initialOffset: initialOffset ?? initialItems.length,
    initialHasMore,
    fetchPage: fetchManagedPage,
    isEnabled,
    isBlocked,
    clearLoadErrorOnLoad,
    sentinelRootMargin,
    sentinelThreshold,
    sentinelBackground,
    observerTargets,
  });

  return {
    items,
    setItems,
    ...infinite,
  };
}
