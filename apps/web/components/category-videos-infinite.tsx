"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArtistVideoLink } from "@/components/artist-video-link";
import { CategoryCreatePlaylistButton } from "@/components/category-create-playlist-button";
import { CloseLink } from "@/components/close-link";
import { useSeenTogglePreference } from "@/components/use-seen-toggle-preference";
import type { VideoRecord } from "@/lib/catalog";

type CategoryVideosInfiniteProps = {
  slug: string;
  genre: string;
  isAuthenticated: boolean;
  seenVideoIds?: string[];
  hiddenVideoIds?: string[];
  initialVideos: VideoRecord[];
  initialHasMore: boolean;
  pageSize?: number;
};

type CategoryVideosPayload = {
  videos?: VideoRecord[];
  hasMore?: boolean;
  nextOffset?: number;
};

const PREFETCH_ROOT_MARGIN = "1800px 0px";
const CHUNK_TRIGGER_ROOT_MARGIN = "1400px 0px";
const INITIAL_BUFFER_PAGES = 3;
const SCROLL_BUFFER_PAGES = 2;
const CATEGORY_HIDE_SEEN_TOGGLE_KEY = "ytr-toggle-hide-seen-category";

function dedupeVideosById(rows: VideoRecord[]) {
  const seen = new Set<string>();
  const unique: VideoRecord[] = [];

  for (const row of rows) {
    if (!row?.id || seen.has(row.id)) {
      continue;
    }

    seen.add(row.id);
    unique.push(row);
  }

  return unique;
}

function filterHiddenVideos(videos: VideoRecord[], hiddenVideoIdSet: Set<string>) {
  if (hiddenVideoIdSet.size === 0) {
    return videos;
  }

  return videos.filter((video) => !hiddenVideoIdSet.has(video.id));
}

function sortVideosBySeen(videos: VideoRecord[], seenVideoIdSet: Set<string>) {
  if (seenVideoIdSet.size === 0) {
    return videos;
  }

  const unseen: VideoRecord[] = [];
  const seen: VideoRecord[] = [];

  for (const video of videos) {
    if (seenVideoIdSet.has(video.id)) {
      seen.push(video);
    } else {
      unseen.push(video);
    }
  }

  return [...unseen, ...seen];
}

export function CategoryVideosInfinite({
  slug,
  genre,
  isAuthenticated,
  seenVideoIds = [],
  hiddenVideoIds = [],
  initialVideos,
  initialHasMore,
  pageSize = 48,
}: CategoryVideosInfiniteProps) {
  const hiddenVideoIdSet = useMemo(() => new Set(hiddenVideoIds), [hiddenVideoIds]);
  const [videos, setVideos] = useState<VideoRecord[]>(() => dedupeVideosById(filterHiddenVideos(initialVideos, hiddenVideoIdSet)));
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hidingVideoIds, setHidingVideoIds] = useState<string[]>([]);
  const [hideSeen, setHideSeen] = useSeenTogglePreference({
    key: CATEGORY_HIDE_SEEN_TOGGLE_KEY,
    isAuthenticated,
  });
  const seenVideoIdSet = new Set(seenVideoIds);
  const nextOffsetRef = useRef(initialVideos.length);
  const requestedOffsetsRef = useRef(new Set<number>());
  const seenIdsRef = useRef(new Set(filterHiddenVideos(initialVideos, hiddenVideoIdSet).map((video) => video.id)));
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const chunkTriggerRef = useRef<HTMLDivElement | null>(null);
  const hasMoreRef = useRef(initialHasMore);
  const videosCountRef = useRef(initialVideos.length);
  const bufferWarmInFlightRef = useRef(false);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    videosCountRef.current = videos.length;
  }, [videos.length]);

  const loadMore = useCallback(async (offset: number, options?: { background?: boolean }) => {
    if (requestedOffsetsRef.current.has(offset) || !hasMore) {
      return { added: 0, hasMore };
    }

    const isBackground = options?.background === true;
    requestedOffsetsRef.current.add(offset);

    if (!isBackground) {
      setIsLoading(true);
      setLoadError(null);
    }

    try {
      const params = new URLSearchParams();
      params.set("offset", String(offset));
      params.set("limit", String(pageSize));

      const response = await fetch(`/api/categories/${encodeURIComponent(slug)}?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("category-videos-load-failed");
      }

      const payload = (await response.json()) as CategoryVideosPayload;
      const incoming = Array.isArray(payload.videos) ? payload.videos : [];
      const uniqueIncoming = filterHiddenVideos(incoming, hiddenVideoIdSet).filter((video) => {
        if (!video?.id || seenIdsRef.current.has(video.id)) {
          return false;
        }

        seenIdsRef.current.add(video.id);
        return true;
      });

      if (uniqueIncoming.length > 0) {
        setVideos((current) => [...current, ...uniqueIncoming]);
      }

      const nextOffset = Number(payload.nextOffset);
      nextOffsetRef.current = Number.isFinite(nextOffset)
        ? nextOffset
        : offset + incoming.length;

      const serverHasMore = Boolean(payload.hasMore);

      // Guard against duplicate-window loops: if server says hasMore but adds nothing,
      // treat the list as exhausted to prevent repeated bottom fetch churn.
      const resolvedHasMore = serverHasMore && uniqueIncoming.length > 0;
      setHasMore(resolvedHasMore);

      return {
        added: uniqueIncoming.length,
        hasMore: resolvedHasMore,
      };
    } catch {
      requestedOffsetsRef.current.delete(offset);
      if (!isBackground) {
        setLoadError("Could not load more videos. Scroll again to retry.");
      }
      return { added: 0, hasMore };
    } finally {
      if (!isBackground) {
        setIsLoading(false);
      }
    }
  }, [hasMore, hiddenVideoIdSet, pageSize, slug]);

  const warmBuffer = useCallback(async (targetCount: number) => {
    if (bufferWarmInFlightRef.current) {
      return;
    }

    bufferWarmInFlightRef.current = true;

    try {
      while (hasMoreRef.current && videosCountRef.current < targetCount) {
        const result = await loadMore(nextOffsetRef.current, { background: true });
        if (result.added === 0 || !result.hasMore) {
          break;
        }
      }
    } finally {
      bufferWarmInFlightRef.current = false;
    }
  }, [loadMore]);

  useEffect(() => {
    if (!hasMore || videos.length >= pageSize * INITIAL_BUFFER_PAGES) {
      return;
    }

    // Prime multiple chunks ahead so users rarely catch the bottom waiting for data.
    void warmBuffer(pageSize * INITIAL_BUFFER_PAGES);
  }, [hasMore, pageSize, videos.length, warmBuffer]);

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
        if (!entry?.isIntersecting || isLoading || !hasMore) {
          return;
        }

        void warmBuffer(videosCountRef.current + pageSize * SCROLL_BUFFER_PAGES);
      },
      {
        root: null,
        rootMargin: PREFETCH_ROOT_MARGIN,
        threshold: 0,
      },
    );

    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [hasMore, isLoading, pageSize, warmBuffer, videos.length]);

  useEffect(() => {
    if (!hasMore) {
      return;
    }

    const trigger = chunkTriggerRef.current;
    if (!trigger) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || isLoading || !hasMore) {
          return;
        }

        void warmBuffer(videosCountRef.current + pageSize * SCROLL_BUFFER_PAGES);
      },
      {
        root: null,
        rootMargin: CHUNK_TRIGGER_ROOT_MARGIN,
        threshold: 0,
      },
    );

    observer.observe(trigger);
    return () => {
      observer.disconnect();
    };
  }, [hasMore, isLoading, pageSize, warmBuffer, videos.length]);

  const orderedVideos = sortVideosBySeen(videos, seenVideoIdSet);

  const handleHideVideo = useCallback(async (video: VideoRecord) => {
    if (!isAuthenticated || hidingVideoIds.includes(video.id)) {
      return;
    }

    setHidingVideoIds((current) => [...current, video.id]);
    setVideos((current) => current.filter((candidate) => candidate.id !== video.id));

    try {
      await fetch("/api/hidden-videos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ videoId: video.id }),
      });
    } catch {
      // Keep card hidden even if persistence fails, matching quick-hide behavior elsewhere.
    } finally {
      setHidingVideoIds((current) => current.filter((id) => id !== video.id));
    }
  }, [hidingVideoIds, isAuthenticated]);

  const visibleOrderedVideos = hideSeen
    ? (isAuthenticated ? orderedVideos.filter((video) => !seenVideoIdSet.has(video.id)) : orderedVideos)
    : orderedVideos;
  const chunkTriggerIndex = visibleOrderedVideos.length > pageSize
    ? Math.max(0, visibleOrderedVideos.length - pageSize * SCROLL_BUFFER_PAGES)
    : -1;

  if (videos.length === 0) {
    return (
      <>
        <div className="favouritesBlindBar">
          <div className="newPageHeaderLeft">
            <strong>
              <span className="categoryHeaderBreadcrumb" aria-label="Breadcrumb">
                <span className="categoryHeaderIcon" aria-hidden="true">☣</span>
                <Link href="/categories" className="categoryHeaderBreadcrumbLink">
                  Categories
                </Link>
                <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
                <span className="categoryHeaderBreadcrumbCurrent" aria-current="page">{genre}</span>
              </span>
            </strong>
          </div>
          <CloseLink />
        </div>
        <p className="categoryNoVideos">No videos found for this category yet.</p>
      </>
    );
  }

  return (
    <>
      <div className="favouritesBlindBar">
        <div className="newPageHeaderLeft">
          <strong>
            <span className="categoryHeaderBreadcrumb" aria-label="Breadcrumb">
              <span className="categoryHeaderIcon" aria-hidden="true">☣</span>
              <Link href="/categories" className="categoryHeaderBreadcrumbLink">
                Categories
              </Link>
              <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
              <span className="categoryHeaderBreadcrumbCurrent" aria-current="page">{genre}</span>
            </span>
          </strong>
          {isAuthenticated ? (
            <button
              type="button"
              className={`newPageSeenToggle${hideSeen ? " newPageSeenToggleActive" : ""}`}
              onClick={() => setHideSeen((value) => !value)}
              aria-pressed={hideSeen}
            >
              {hideSeen ? "Showing unseen only" : "Show unseen only"}
            </button>
          ) : null}
          <CategoryCreatePlaylistButton
            isAuthenticated={isAuthenticated}
            slug={slug}
            categoryName={genre}
            videos={visibleOrderedVideos}
            seenVideoIds={seenVideoIds}
            hideSeenOnly={hideSeen}
          />
        </div>
        <CloseLink />
      </div>

      <div className="categoryVideoGrid">
        {visibleOrderedVideos.map((video, index) => (
          <div
            key={video.id}
            className="categoryVideoObserverAnchor"
            ref={index === chunkTriggerIndex ? chunkTriggerRef : undefined}
          >
            <ArtistVideoLink
              video={video}
              isAuthenticated={isAuthenticated}
              isSeen={seenVideoIdSet.has(video.id)}
              useCornerActions
              onHideVideo={handleHideVideo}
              isHidePending={hidingVideoIds.includes(video.id)}
            />
          </div>
        ))}
      </div>

      <div className="routeContractRow" aria-live="polite">
        {isLoading ? <span>Loading more {genre} tracks...</span> : null}
        {loadError ? <span>{loadError}</span> : null}
        {!isLoading && !hasMore && !loadError ? <span>End of {genre} tracks.</span> : null}
      </div>

      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
    </>
  );
}
