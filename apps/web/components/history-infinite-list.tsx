"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { ArtistWikiLink } from "@/components/artist-wiki-link";
import type { WatchHistoryEntry } from "@/lib/catalog-data";

type HistoryInfiniteListProps = {
  initialHistory: WatchHistoryEntry[];
  initialHasMore: boolean;
  pageSize?: number;
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

export function HistoryInfiniteList({ initialHistory, initialHasMore, pageSize = 40 }: HistoryInfiniteListProps) {
  const [history, setHistory] = useState<WatchHistoryEntry[]>(initialHistory);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const nextOffsetRef = useRef(initialHistory.length);
  const requestedOffsetsRef = useRef(new Set<number>());

  const seenKeys = useMemo(() => {
    return new Set(history.map((entry) => `${entry.video.id}:${entry.lastWatchedAt}`));
  }, [history]);

  const groupedHistory = useMemo<HistoryGroup[]>(() => {
    const groups: HistoryGroup[] = [];
    const byKey = new Map<string, HistoryGroup>();

    for (const entry of history) {
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
  }, [history]);

  async function loadMore(offset: number) {
    if (requestedOffsetsRef.current.has(offset) || isLoading || !hasMore) {
      return;
    }

    requestedOffsetsRef.current.add(offset);
    setIsLoading(true);
    setLoadError(null);

    try {
      const response = await fetch(`/api/watch-history?limit=${pageSize}&offset=${offset}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("history-load-failed");
      }

      const payload = (await response.json()) as WatchHistoryPayload;
      const incoming = Array.isArray(payload.history) ? payload.history : [];

      const uniqueIncoming = incoming.filter((entry) => {
        const key = `${entry.video.id}:${entry.lastWatchedAt}`;
        return !seenKeys.has(key);
      });

      if (uniqueIncoming.length > 0) {
        setHistory((current) => [...current, ...uniqueIncoming]);
      }

      const nextOffset = Number(payload.nextOffset);
      nextOffsetRef.current = Number.isFinite(nextOffset) ? nextOffset : offset + incoming.length;
      setHasMore(Boolean(payload.hasMore));
    } catch {
      requestedOffsetsRef.current.delete(offset);
      setLoadError("Could not load more history. Scroll again to retry.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!hasMore) {
      return;
    }

    const sentinel = sentinelRef.current;
    if (!sentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) {
          return;
        }

        void loadMore(nextOffsetRef.current);
      },
      {
        root: null,
        rootMargin: "600px 0px",
        threshold: 0,
      },
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, isLoading]);

  if (history.length === 0) {
    return (
      <section className="accountHistoryPanel historyPagePanel">
        <p className="authMessage">Play a few tracks and your history will appear here.</p>
      </section>
    );
  }

  return (
    <section className="accountHistoryPanel historyPagePanel">
      <div className="historyGroups">
        {groupedHistory.map((group) => (
          <section key={group.key} className="historyDateGroup" aria-label={group.label}>
            <h3 className="historyDateHeading">{group.label}</h3>
            <ul className="accountHistoryList historyGroupList">
              {group.entries.map((entry) => (
                <li key={`${entry.video.id}:${entry.lastWatchedAt}`}>
                  <article className="trackCard leaderboardCard historyCard">
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
                  </article>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="routeContractRow" aria-live="polite">
        {isLoading ? <span>Loading more history...</span> : null}
        {loadError ? <span>{loadError}</span> : null}
        {!isLoading && !hasMore && !loadError ? <span>End of watch history.</span> : null}
      </div>

      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
    </section>
  );
}
