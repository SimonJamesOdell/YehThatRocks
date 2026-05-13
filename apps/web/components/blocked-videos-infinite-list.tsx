"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { RouteLoaderContractRow } from "@/components/route-loader-contract-row";
import { useInfiniteListController } from "@/components/use-infinite-list-controller";
import type { HiddenVideoEntry } from "@/lib/catalog-data";
import { fetchJsonWithLoaderContract } from "@/lib/frontend-data-loader";
import { mutateHiddenVideo } from "@/lib/hidden-video-client-service";

type BlockedVideosInfiniteListProps = {
  initialBlockedVideos: HiddenVideoEntry[];
  initialHasMore: boolean;
  pageSize?: number;
};

type BlockedVideosPayload = {
  blockedVideos?: HiddenVideoEntry[];
  hasMore?: boolean;
  nextOffset?: number;
};

function getVideoThumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
}

function formatBlockedTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Recently";
  }

  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BlockedVideosInfiniteList({
  initialBlockedVideos,
  initialHasMore,
  pageSize = 24,
}: BlockedVideosInfiniteListProps) {
  const [filterValue, setFilterValue] = useState("");
  const [unblockingIds, setUnblockingIds] = useState<Set<string>>(new Set());
  const {
    items: blockedVideos,
    setItems: setBlockedVideos,
    hasMore,
    isLoading,
    loadError,
    setLoadError,
    sentinelRef,
    retryLoadMore,
  } = useInfiniteListController<HiddenVideoEntry>({
    initialItems: initialBlockedVideos,
    initialOffset: initialBlockedVideos.length,
    initialHasMore,
    getItemKey: (entry) => entry.video.id,
    stopOnNoUniqueIncoming: true,
    sentinelRootMargin: "600px 0px",
    fetchPage: useCallback(async (offset) => {
      const result = await fetchJsonWithLoaderContract<BlockedVideosPayload>({
        input: `/api/hidden-videos?limit=${pageSize}&offset=${offset}`,
        init: {
          cache: "no-store",
        },
        failureMessage: "Could not load more blocked videos. Please retry.",
      });

      if (!result.ok) {
        return {
          incoming: [],
          hasMore: false,
          nextOffset: offset,
          errorMessage: result.message,
        };
      }

      const payload = result.data;
      const incoming = Array.isArray(payload.blockedVideos) ? payload.blockedVideos : [];

      const nextOffset = Number(payload.nextOffset);
      return {
        incoming,
        hasMore: Boolean(payload.hasMore),
        incomingCountForOffset: incoming.length,
        nextOffset: Number.isFinite(nextOffset) ? nextOffset : offset + incoming.length,
      };
    }, [pageSize]),
  });

  const filteredBlockedVideos = useMemo(() => {
    const needle = filterValue.trim().toLowerCase();
    if (!needle) {
      return blockedVideos;
    }

    return blockedVideos.filter((entry) => {
      const title = entry.video.title.toLowerCase();
      const artist = (entry.video.channelTitle || "").toLowerCase();
      return title.startsWith(needle) || artist.startsWith(needle);
    });
  }, [blockedVideos, filterValue]);

  async function handleUnblock(videoId: string) {
    if (unblockingIds.has(videoId)) {
      return;
    }

    let removedEntry: HiddenVideoEntry | null = null;

    setUnblockingIds((current) => new Set(current).add(videoId));

    const result = await mutateHiddenVideo({
      action: "unhide",
      videoId,
      rollbackOnError: true,
      onOptimisticUpdate: () => {
        setBlockedVideos((current) => {
          removedEntry = current.find((entry) => entry.video.id === videoId) ?? null;
          return current.filter((entry) => entry.video.id !== videoId);
        });
      },
      onRollback: () => {
        if (!removedEntry) {
          return;
        }

        setBlockedVideos((current) => [removedEntry as HiddenVideoEntry, ...current]);
      },
      onSettled: () => {
        setUnblockingIds((current) => {
          const next = new Set(current);
          next.delete(videoId);
          return next;
        });
      },
    });

    if (!result.ok) {
      setLoadError(result.message);
    }
  }

  if (blockedVideos.length === 0) {
    return (
      <section className="accountHistoryPanel historyPagePanel">
        <p className="authMessage">No blocked videos yet.</p>
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
          aria-label="Filter blocked videos by prefix"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <ul className="accountHistoryList historyGroupList blockedVideosList">
        {filteredBlockedVideos.length > 0 ? filteredBlockedVideos.map((entry) => (
          <li key={`${entry.video.id}:${entry.hiddenAt}`}>
            <article className="trackCard leaderboardCard historyCard blockedVideosCard">
              <Link
                href={`/?v=${encodeURIComponent(entry.video.id)}`}
                className="linkedCard leaderboardTrackLink historyTrackLink blockedVideoTrackLink"
                prefetch={false}
              >
                <div className="historyTimeBadge">Blocked</div>
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
                    {" "}· {formatBlockedTimestamp(entry.hiddenAt)}
                  </p>
                </div>
              </Link>
              <button
                type="button"
                className="blockedVideoUnblockButton"
                onClick={() => {
                  void handleUnblock(entry.video.id);
                }}
                disabled={unblockingIds.has(entry.video.id)}
                aria-label={`Unblock ${entry.video.title}`}
                title="Unblock video"
              >
                {unblockingIds.has(entry.video.id) ? "..." : "Unblock"}
              </button>
            </article>
          </li>
        )) : (
          <li>
            <p className="authMessage">No blocked videos match that prefix.</p>
          </li>
        )}
      </ul>

      <RouteLoaderContractRow
        isLoading={isLoading}
        loadingLabel="Loading more blocked videos..."
        error={loadError}
        onRetry={loadError ? retryLoadMore : null}
        endLabel={!isLoading && !hasMore && !loadError ? "End of blocked videos." : null}
      />

      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
    </section>
  );
}
