"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { RouteLoaderContractRow } from "@/components/route-loader-contract-row";
import { useInfiniteScroll } from "@/components/use-infinite-scroll";
import { EVENT_NAMES, listenToAppEvent } from "@/lib/events-contract";
import { fetchJsonWithLoaderContract } from "@/lib/frontend-data-loader";
import type { WatchHistoryEntry } from "@/lib/catalog-data";

type HistoryInfiniteListProps = {
  initialHistory: WatchHistoryEntry[];
  initialHasMore: boolean;
  pageSize?: number;
  isAuthenticated?: boolean;
};

type WatchHistoryPayload = {
  history?: WatchHistoryEntry[];
  hasMore?: boolean;
  nextOffset?: number;
};

type HistoryGroup = {
  key: string;
  label: string;
  entries: WatchHistoryEntry[];
};

const HISTORY_FIRST_REFRESH_TIMEOUT_MS = 6_500;

function getVideoThumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
}

function formatHistoryTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Recently watched";
  }

  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHistoryTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Now";
  }

  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toLocalDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDateHeadingLabel(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Recently watched";
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetStart = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  const diffDays = Math.round((todayStart.getTime() - targetStart.getTime()) / 86_400_000);

  if (diffDays === 0) {
    return "Today";
  }

  if (diffDays === 1) {
    return "Yesterday";
  }

  return parsed.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function HistoryInfiniteList({
  initialHistory,
  initialHasMore,
  pageSize = 40,
  isAuthenticated = false,
}: HistoryInfiniteListProps) {
  const router = useRouter();
  const [history, setHistory] = useState<WatchHistoryEntry[]>(initialHistory);
  const [filterValue, setFilterValue] = useState("");
  const [isRefreshingInitialHistory, setIsRefreshingInitialHistory] = useState(initialHistory.length === 0);
  const [initialRefreshError, setInitialRefreshError] = useState<string | null>(null);
  const [initialRefreshRetryNonce, setInitialRefreshRetryNonce] = useState(0);
  const {
    hasMore,
    isLoading,
    loadError,
    setLoadError,
    sentinelRef,
    loadMore,
    retryLoadMore,
    resetPagination,
  } = useInfiniteScroll({
    initialOffset: initialHistory.length,
    initialHasMore,
    sentinelRootMargin: "600px 0px",
    fetchPage: useCallback(async (offset) => {
      const result = await fetchJsonWithLoaderContract<WatchHistoryPayload>({
        input: `/api/watch-history?limit=${pageSize}&offset=${offset}`,
        init: {
          cache: "no-store",
        },
        failureMessage: "Could not load more history. Please retry.",
      });

      if (!result.ok) {
        return {
          added: 0,
          hasMore: false,
          nextOffset: offset,
          errorMessage: result.message,
        };
      }

      const payload = result.data;
      const incoming = Array.isArray(payload.history) ? payload.history : [];

      let added = 0;
      setHistory((current) => {
        const seen = new Set(current.map((entry) => `${entry.video.id}:${entry.lastWatchedAt}`));
        const uniqueIncoming = incoming.filter((entry) => !seen.has(`${entry.video.id}:${entry.lastWatchedAt}`));
        added = uniqueIncoming.length;

        if (added === 0) {
          return current;
        }

        return [...current, ...uniqueIncoming];
      });

      const nextOffset = Number(payload.nextOffset);
      return {
        added,
        hasMore: Boolean(payload.hasMore),
        nextOffset: Number.isFinite(nextOffset) ? nextOffset : offset + incoming.length,
      };
    }, [pageSize]),
  });

  const filteredHistory = useMemo(() => {
    const needle = filterValue.trim().toLowerCase();
    if (!needle) {
      return history;
    }

    return history.filter((entry) => {
      const title = entry.video.title.toLowerCase();
      const artist = (entry.video.channelTitle || "").toLowerCase();
      return title.startsWith(needle) || artist.startsWith(needle);
    });
  }, [filterValue, history]);

  const groupedHistory = useMemo<HistoryGroup[]>(() => {
    const groups: HistoryGroup[] = [];
    const byKey = new Map<string, HistoryGroup>();

    for (const entry of filteredHistory) {
      const parsed = new Date(entry.lastWatchedAt);
      const key = Number.isNaN(parsed.getTime()) ? "unknown" : toLocalDayKey(parsed);
      let group = byKey.get(key);

      if (!group) {
        group = {
          key,
          label: getDateHeadingLabel(entry.lastWatchedAt),
          entries: [],
        };
        byKey.set(key, group);
        groups.push(group);
      }

      group.entries.push(entry);
    }

    return groups;
  }, [filteredHistory]);

  const refreshLatestHistoryWindow = useCallback(async (options?: { initial?: boolean }) => {
    if (options?.initial) {
      setIsRefreshingInitialHistory(true);
      setInitialRefreshError(null);
    }

    try {
      const result = await fetchJsonWithLoaderContract<WatchHistoryPayload>({
        input: `/api/watch-history?limit=${pageSize}&offset=0`,
        init: {
          cache: "no-store",
        },
        timeoutMs: options?.initial ? HISTORY_FIRST_REFRESH_TIMEOUT_MS : undefined,
        failureMessage: options?.initial
          ? "Could not refresh history. Please retry."
          : "Could not refresh history right now.",
      });

      if (!result.ok) {
        if (options?.initial) {
          setInitialRefreshError(result.message);
        }
        return;
      }

      const payload = result.data;
      const latest = Array.isArray(payload.history) ? payload.history : [];
      const hasMoreLatest = Boolean(payload.hasMore);
      const nextOffset = Number(payload.nextOffset);

      setHistory(latest);
      resetPagination({
        hasMore: hasMoreLatest,
        offset: Number.isFinite(nextOffset) ? nextOffset : latest.length,
      });
    } catch {
      if (options?.initial) {
        setInitialRefreshError("Could not refresh history. Please retry.");
      }
    } finally {
      if (options?.initial) {
        setIsRefreshingInitialHistory(false);
      }
    }
  }, [pageSize]);

  const retryInitialHistoryRefresh = useCallback(() => {
    setInitialRefreshError(null);
    setInitialRefreshRetryNonce((current) => current + 1);
  }, []);

  const retryLoadMoreHistory = useCallback(() => {
    retryLoadMore();
  }, [retryLoadMore]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await refreshLatestHistoryWindow({ initial: true });
      if (cancelled) {
        return;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialRefreshRetryNonce, refreshLatestHistoryWindow]);

  useEffect(() => {
    const handleWatchHistoryUpdated = () => {
      void refreshLatestHistoryWindow();
    };

    const unsubscribe = listenToAppEvent(EVENT_NAMES.WATCH_HISTORY_UPDATED, handleWatchHistoryUpdated);

    return () => {
      unsubscribe();
    };
  }, [refreshLatestHistoryWindow]);

  if (history.length === 0) {
    return (
      <section className="accountHistoryPanel historyPagePanel">
        <RouteLoaderContractRow
          isLoading={isRefreshingInitialHistory}
          loadingLabel="Loading history..."
          error={initialRefreshError}
          onRetry={!isRefreshingInitialHistory && initialRefreshError ? retryInitialHistoryRefresh : null}
          endLabel={!isRefreshingInitialHistory && !initialRefreshError ? "Play a few tracks and your history will appear here." : null}
        />
      </section>
    );
  }

  return (
    <section className="accountHistoryPanel historyPagePanel">
      <div className="historyFilterBar">
        <input
          type="text"
          className="categoriesFilterInput"
          placeholder="type to filter..."
          value={filterValue}
          onChange={(event) => setFilterValue(event.target.value)}
          aria-label="Filter history by prefix"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="historyGroups">
        {groupedHistory.length > 0 ? groupedHistory.map((group) => (
          <section key={group.key} className="historyDateGroup" aria-label={group.label}>
            <h3 className="historyDateHeading">{group.label}</h3>
            <ul className="accountHistoryList historyGroupList">
              {group.entries.map((entry) => (
                <li key={`${entry.video.id}:${entry.lastWatchedAt}`}>
                  <article
                    className="trackCard leaderboardCard historyCard"
                    role="link"
                    tabIndex={0}
                    aria-label={`Play ${entry.video.title}`}
                    onClick={(event) => {
                      if (event.defaultPrevented) {
                        return;
                      }

                      const target = event.target;
                      if (target instanceof Element && target.closest("a")) {
                        return;
                      }

                      router.push(`/?v=${encodeURIComponent(entry.video.id)}&resume=1`);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") {
                        return;
                      }

                      event.preventDefault();
                      router.push(`/?v=${encodeURIComponent(entry.video.id)}&resume=1`);
                    }}
                  >
                    <Link
                      href={`/?v=${encodeURIComponent(entry.video.id)}&resume=1`}
                      className="linkedCard leaderboardTrackLink historyTrackLink"
                      prefetch={false}
                    >
                      <div className="historyTimeBadge">{formatHistoryTime(entry.lastWatchedAt)}</div>
                      <div className="leaderboardThumbWrap">
                        <img
                          src={getVideoThumbnailUrl(entry.video.id)}
                          alt=""
                          className="leaderboardThumb accountHistoryThumb"
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                      <div className="leaderboardMeta historyMeta">
                        <h3>{entry.video.title}</h3>
                        <p>
                          <ArtistWikiLink
                            artistName={entry.video.channelTitle || "Unknown Artist"}
                            videoId={entry.video.id}
                            className="artistInlineLink"
                          >
                            {entry.video.channelTitle || "Unknown Artist"}
                          </ArtistWikiLink>
                          {" "}· {entry.watchCount} plays · {Math.round(entry.maxProgressPercent)}% · {formatHistoryTimestamp(entry.lastWatchedAt)}
                        </p>
                      </div>
                    </Link>
                    {isAuthenticated ? (
                      <div
                        className="historyCardAction"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <AddToPlaylistButton
                          videoId={entry.video.id}
                          isAuthenticated={isAuthenticated}
                          className="historyCardPlaylistAddButton"
                          compact
                        />
                      </div>
                    ) : null}
                  </article>
                </li>
              ))}
            </ul>
          </section>
        )) : (
          <section className="accountHistoryPanel historyPagePanel">
            <p className="authMessage">No history entries match that prefix.</p>
          </section>
        )}
      </div>

      <RouteLoaderContractRow
        isLoading={isLoading}
        loadingLabel="Loading more history..."
        error={loadError}
        onRetry={loadError ? retryLoadMoreHistory : null}
        endLabel={!isLoading && !hasMore && !loadError ? "End of watch history." : null}
      />

      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
    </section>
  );
}
