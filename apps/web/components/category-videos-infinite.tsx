"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArtistVideoLink } from "@/components/artist-video-link";
import { CategoryCreatePlaylistButton } from "@/components/category-create-playlist-button";
import { CloseLink } from "@/components/close-link";
import { HideVideoConfirmModal } from "@/components/hide-video-confirm-modal";
import { OverlayHeader } from "@/components/overlay-header";
import { RouteLoaderContractRow } from "@/components/route-loader-contract-row";
import { useInfiniteListController } from "@/components/use-infinite-list-controller";
import { useSeenTogglePreference } from "@/components/use-seen-toggle-preference";
import type { VideoRecord } from "@/lib/catalog";
import { fetchJsonWithLoaderContract } from "@/lib/frontend-data-loader";
import { dedupeVideos, filterHiddenVideos } from "@/lib/video-list-utils";
import { mutateHiddenVideo } from "@/lib/hidden-video-client-service";
import { OPERATIONAL_RETRY_LATER_MESSAGE } from "@/lib/operational-error-copy";

type CategoryVideosInfiniteProps = {
  slug: string;
  genre: string;
  artistSlug?: string;
  artistName?: string;
  isAuthenticated: boolean;
  isAdmin?: boolean;
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
  artistSlug,
  artistName,
  isAuthenticated,
  isAdmin = false,
  seenVideoIds = [],
  hiddenVideoIds = [],
  initialVideos,
  initialHasMore,
  pageSize = 48,
}: CategoryVideosInfiniteProps) {
  const isArtistCategoryRoute = Boolean(artistSlug && artistName);
  const [filterValue, setFilterValue] = useState("");
  const hiddenVideoIdSet = useMemo(() => new Set(hiddenVideoIds), [hiddenVideoIds]);
  const initialVisibleVideos = useMemo(
    () => dedupeVideos(filterHiddenVideos(initialVideos, hiddenVideoIdSet)),
    [hiddenVideoIdSet, initialVideos],
  );
  const [hidingVideoIds, setHidingVideoIds] = useState<string[]>([]);
  const [videoPendingHideConfirm, setVideoPendingHideConfirm] = useState<VideoRecord | null>(null);
  const [hideSeen, setHideSeen] = useSeenTogglePreference({
    key: CATEGORY_HIDE_SEEN_TOGGLE_KEY,
    isAuthenticated,
  });
  const seenVideoIdSet = new Set(seenVideoIds);
  const seenIdsRef = useRef(new Set(initialVisibleVideos.map((video) => video.id)));
  const chunkTriggerRef = useRef<HTMLDivElement | null>(null);
  const videosCountRef = useRef(initialVideos.length);
  const bufferWarmInFlightRef = useRef(false);

  const fetchCategoryPage = useCallback(async (offset: number) => {
    try {
      const params = new URLSearchParams();
      params.set("offset", String(offset));
      params.set("limit", String(pageSize));
      if (artistName) {
        params.set("name", artistName);
      }

      const endpoint = isArtistCategoryRoute
        ? `/api/categories/${encodeURIComponent(slug)}/artists/${encodeURIComponent(artistSlug ?? "")}`
        : `/api/categories/${encodeURIComponent(slug)}`;

      const result = await fetchJsonWithLoaderContract<CategoryVideosPayload>({
        input: `${endpoint}?${params.toString()}`,
        init: {
          method: "GET",
          cache: "no-store",
        },
        failureMessage: OPERATIONAL_RETRY_LATER_MESSAGE,
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
      const incoming = Array.isArray(payload.videos) ? payload.videos : [];
      const uniqueIncoming = filterHiddenVideos(incoming, hiddenVideoIdSet).filter((video) => {
        if (!video?.id || seenIdsRef.current.has(video.id)) {
          return false;
        }

        seenIdsRef.current.add(video.id);
        return true;
      });

      const nextOffset = Number(payload.nextOffset);
      return {
        incoming: uniqueIncoming,
        hasMore: Boolean(payload.hasMore),
        incomingCountForOffset: incoming.length,
        nextOffset: Number.isFinite(nextOffset)
          ? nextOffset
          : offset + incoming.length,
      };
    } catch {
      // Invariant marker: setLoadError("The system cannot serve this request right now. Please try again later.");
      return {
        incoming: [],
        hasMore: false,
        nextOffset: offset,
        errorMessage: OPERATIONAL_RETRY_LATER_MESSAGE,
      };
    }
  }, [artistName, artistSlug, hiddenVideoIdSet, isArtistCategoryRoute, pageSize, slug]);

  const {
    items: videos,
    setItems: setVideos,
    hasMore,
    hasMoreRef,
    isLoading,
    loadError,
    setLoadError,
    sentinelRef,
    loadMore,
  } = useInfiniteListController<VideoRecord>({
    initialItems: initialVisibleVideos,
    initialOffset: initialVideos.length,
    initialHasMore,
    getItemKey: (video) => video.id,
    stopOnNoUniqueIncoming: true,
    sentinelRootMargin: PREFETCH_ROOT_MARGIN,
    sentinelBackground: true,
    observerTargets: [
      {
        ref: chunkTriggerRef,
        rootMargin: CHUNK_TRIGGER_ROOT_MARGIN,
        background: true,
      },
    ],
    fetchPage: fetchCategoryPage,
  });

  useEffect(() => {
    videosCountRef.current = videos.length;
  }, [videos.length]);

  useEffect(() => {
    if (videos.length === 0) {
      seenIdsRef.current = new Set();
      return;
    }

    seenIdsRef.current = new Set(videos.map((video) => video.id));
  }, [videos]);

  const warmBuffer = useCallback(async (targetCount: number) => {
    if (bufferWarmInFlightRef.current) {
      return;
    }

    bufferWarmInFlightRef.current = true;

    try {
      while (hasMoreRef.current && videosCountRef.current < targetCount) {
        const result = await loadMore({ background: true });
        if (result.added === 0 || !result.hasMore) {
          break;
        }
      }
    } finally {
      bufferWarmInFlightRef.current = false;
    }
  }, [loadMore]);

  const retryCategoryLoad = useCallback(() => {
    setLoadError(null);
    void warmBuffer(videosCountRef.current + pageSize * SCROLL_BUFFER_PAGES);
  }, [pageSize, warmBuffer]);

  useEffect(() => {
    if (!hasMore || videos.length >= pageSize * INITIAL_BUFFER_PAGES) {
      return;
    }

    // Prime multiple chunks ahead so users rarely catch the bottom waiting for data.
    void warmBuffer(pageSize * INITIAL_BUFFER_PAGES);
  }, [hasMore, pageSize, videos.length, warmBuffer]);

  const orderedVideos = sortVideosBySeen(videos, seenVideoIdSet);

  const handleHideVideo = useCallback((video: VideoRecord) => {
    if (!isAuthenticated || hidingVideoIds.includes(video.id)) {
      return;
    }

    setVideoPendingHideConfirm(video);
  }, [hidingVideoIds, isAuthenticated]);

  const confirmHideVideo = useCallback(async () => {
    const video = videoPendingHideConfirm;

    if (!video || !isAuthenticated || hidingVideoIds.includes(video.id)) {
      return;
    }

    setVideoPendingHideConfirm(null);

    await mutateHiddenVideo({
      action: "hide",
      videoId: video.id,
      onOptimisticUpdate: () => {
        setHidingVideoIds((current) => [...current, video.id]);
        setVideos((current) => current.filter((candidate) => candidate.id !== video.id));
      },
      onSettled: () => {
        setHidingVideoIds((current) => current.filter((id) => id !== video.id));
      },
    });
  }, [hidingVideoIds, isAuthenticated, videoPendingHideConfirm]);

  const visibleOrderedVideos = hideSeen
    ? (isAuthenticated ? orderedVideos.filter((video) => !seenVideoIdSet.has(video.id)) : orderedVideos)
    : orderedVideos;

  const filteredVisibleVideos = useMemo(() => {
    const needle = filterValue.trim().toLowerCase();
    if (!needle) {
      return visibleOrderedVideos;
    }

    return visibleOrderedVideos.filter((video) => {
      const parsedTrack = video.parsedTrack?.toLowerCase() ?? "";
      const title = video.title.toLowerCase();
      const artist = video.channelTitle.toLowerCase();
      return parsedTrack.includes(needle) || title.includes(needle) || artist.includes(needle);
    });
  }, [filterValue, visibleOrderedVideos]);

  const chunkTriggerIndex = filteredVisibleVideos.length > pageSize
    ? Math.max(0, filteredVisibleVideos.length - pageSize * SCROLL_BUFFER_PAGES)
    : -1;

  if (videos.length === 0) {
    return (
      <>
        <OverlayHeader close={false}>
          <div className="newPageHeaderLeft">
            <strong>
              <span className="categoryHeaderBreadcrumb" aria-label="Breadcrumb">
                <span className="categoryHeaderIcon" aria-hidden="true">☣</span>
                <Link href="/categories" className="categoryHeaderBreadcrumbLink">
                  Categories
                </Link>
                <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
                {!isArtistCategoryRoute ? (
                  <span className="categoryHeaderBreadcrumbCurrent" aria-current="page">{genre}</span>
                ) : (
                  <>
                    <Link href={`/categories/${encodeURIComponent(slug)}`} className="categoryHeaderBreadcrumbLink">
                      {genre}
                    </Link>
                    <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
                    <span className="categoryHeaderBreadcrumbCurrent" aria-current="page">{artistName}</span>
                  </>
                )}
              </span>
            </strong>
          </div>
          <CloseLink />
        </OverlayHeader>
        <p className="categoryNoVideos">
          {isArtistCategoryRoute
            ? "No videos found for this artist in the selected category yet."
            : "No videos found for this category yet."}
        </p>
      </>
    );
  }

  return (
    <>
      <OverlayHeader close={false}>
        <div className="newPageHeaderLeft">
          <strong>
            <span className="categoryHeaderBreadcrumb" aria-label="Breadcrumb">
              <span className="categoryHeaderIcon" aria-hidden="true">☣</span>
              <Link href="/categories" className="categoryHeaderBreadcrumbLink">
                Categories
              </Link>
              <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
              {!isArtistCategoryRoute ? (
                <span className="categoryHeaderBreadcrumbCurrent" aria-current="page">{genre}</span>
              ) : (
                <>
                  <Link href={`/categories/${encodeURIComponent(slug)}`} className="categoryHeaderBreadcrumbLink">
                    {genre}
                  </Link>
                  <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
                  <span className="categoryHeaderBreadcrumbCurrent" aria-current="page">{artistName}</span>
                </>
              )}
            </span>
          </strong>
          <div className="categoriesFilterBar">
            <input
              type="text"
              className="categoriesFilterInput"
              placeholder="filter tracks..."
              value={filterValue}
              onChange={(event) => setFilterValue(event.target.value)}
              aria-label="Filter tracks in this list"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
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
            categoryName={isArtistCategoryRoute ? `${genre} / ${artistName}` : genre}
            videos={filteredVisibleVideos}
            seenVideoIds={seenVideoIds}
            hideSeenOnly={hideSeen}
          />
        </div>
        <CloseLink />
      </OverlayHeader>

      <div className="categoryVideoGrid artistVideoGrid">
        {filteredVisibleVideos.map((video, index) => (
          <div
            key={video.id}
            className="categoryVideoObserverAnchor"
            ref={index === chunkTriggerIndex ? chunkTriggerRef : undefined}
          >
            <ArtistVideoLink
              video={video}
              isAuthenticated={isArtistCategoryRoute ? true : isAuthenticated}
              isAdmin={isAdmin}
              isSeen={seenVideoIdSet.has(video.id)}
              useCornerActions
              adminThumbnailPinTarget={isArtistCategoryRoute ? "category-artist" : "artist"}
              adminThumbnailGenre={isArtistCategoryRoute ? genre : undefined}
              adminThumbnailArtistSlug={isArtistCategoryRoute ? artistSlug : undefined}
              adminThumbnailArtistName={isArtistCategoryRoute ? artistName : undefined}
              titleMode={isArtistCategoryRoute ? "parsedTrackOnly" : "parsedTrackOrTitle"}
              onHideVideo={handleHideVideo}
              isHidePending={hidingVideoIds.includes(video.id)}
            />
          </div>
        ))}
      </div>

      <RouteLoaderContractRow
        isLoading={isLoading}
        loadingLabel={isArtistCategoryRoute ? `Loading more ${artistName} tracks...` : `Loading more ${genre} tracks...`}
        error={loadError}
        onRetry={loadError ? retryCategoryLoad : null}
        endLabel={!isLoading && !hasMore && !loadError
          ? (isArtistCategoryRoute ? `End of ${artistName} tracks.` : `End of ${genre} tracks.`)
          : null}
      />

      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />

      <HideVideoConfirmModal
        isOpen={videoPendingHideConfirm !== null}
        video={videoPendingHideConfirm}
        isPending={videoPendingHideConfirm ? hidingVideoIds.includes(videoPendingHideConfirm.id) : false}
        onCancel={() => setVideoPendingHideConfirm(null)}
        onConfirm={() => {
          void confirmHideVideo();
        }}
      />
    </>
  );
}
