"use client";

import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { CloseLink } from "@/components/close-link";
import { OverlayHeader } from "@/components/overlay-header";
import type { VideoRecord } from "@/lib/catalog";
import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";
import { EVENT_NAMES, dispatchAppEvent, listenToAppEvent } from "@/lib/events-contract";
import { createPlaylistFromVideoList } from "@/lib/playlist-create-from-video-list";

const FAVOURITES_BATCH_SIZE = 20;

type FavouritesPayload = {
  favourites?: VideoRecord[];
  totalCount?: number;
  hasMore?: boolean;
  nextOffset?: number;
};

type FavouritesGridProps = {
  initialFavourites: VideoRecord[];
  initialTotalCount: number;
  initialHasMore: boolean;
  isAuthenticated: boolean;
};

type FavouritesGridCardProps = {
  track: VideoRecord;
  isAuthenticated: boolean;
  isPending: boolean;
  isRemoving: boolean;
  isCreatingPlaylistFromFavourites: boolean;
  onOpenVideo: (videoId: string) => void;
  onRemoveFavourite: (videoId: string) => void;
};

const FavouritesGridCard = memo(function FavouritesGridCard({
  track,
  isAuthenticated,
  isPending,
  isRemoving,
  isCreatingPlaylistFromFavourites,
  onOpenVideo,
  onRemoveFavourite,
}: FavouritesGridCardProps) {
  return (
    <article
      className="catalogCard categoryCard favouritesCardCompact playlistCardInteractive"
      role="link"
      tabIndex={0}
      aria-label={`Play ${track.title}`}
      onClick={() => onOpenVideo(track.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenVideo(track.id);
        }
      }}
    >
      <div className="favouritesThumbOverlayWrap">
        <div className="categoryThumbWrap">
          <Image
            src={`https://i.ytimg.com/vi/${track.id}/mqdefault.jpg`}
            alt=""
            width={320}
            height={180}
            className="categoryThumb"
            loading="lazy"
            sizes="(max-width: 768px) 92vw, (max-width: 1200px) 44vw, 320px"
          />
        </div>
        <button
          type="button"
          className="favouritesDeleteButton favouritesDeleteOverlayButton"
          onClick={(event) => {
            event.stopPropagation();
            onRemoveFavourite(track.id);
          }}
          disabled={!isAuthenticated || isPending || isRemoving || isCreatingPlaylistFromFavourites}
          aria-label={`Remove ${track.title} from favourites`}
          title="Remove from favourites"
        >
          {isRemoving ? "…" : "🗑"}
        </button>
      </div>
      <div className="relatedCardSourceBadges artistVideoSourceBadges">
        {track.isFavouriteSource ? <span className="relatedSourceBadge relatedSourceBadgeFavourite">Favourite</span> : null}
        {track.isTop100Source ? <span className="relatedSourceBadge relatedSourceBadgeTop100">Top100</span> : null}
        {track.isNewSource ? <span className="relatedSourceBadge relatedSourceBadgeNew">New</span> : null}
      </div>
      <h3>
        <span className="cardTitleLink playlistCardTitleStatic">
          {track.title}
        </span>
      </h3>
      <p>
        <ArtistWikiLink artistName={track.channelTitle} videoId={track.id} className="artistInlineLink">
          {track.channelTitle}
        </ArtistWikiLink>
      </p>
      <div className="actionRow favouritesCardActionsRow">
        <div
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <AddToPlaylistButton
            videoId={track.id}
            isAuthenticated={isAuthenticated}
            compact
            className="favouritesPlaylistCircleButton"
          />
        </div>
      </div>
    </article>
  );
});

export function FavouritesGrid({
  initialFavourites,
  initialTotalCount,
  initialHasMore,
  isAuthenticated,
}: FavouritesGridProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [favourites, setFavourites] = useState<VideoRecord[]>(initialFavourites);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterValue, setFilterValue] = useState("");
  const [pendingVideoId, setPendingVideoId] = useState<string | null>(null);
  const [isCreatingPlaylistFromFavourites, setIsCreatingPlaylistFromFavourites] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const nextOffsetRef = useRef(initialFavourites.length);
  const requestedOffsetsRef = useRef(new Set<number>());

  const filteredFavourites = useMemo(() => {
    const needle = filterValue.trim().toLowerCase();
    if (!needle) {
      return favourites;
    }

    return favourites.filter((track) => {
      const title = track.title.toLowerCase();
      const artist = track.channelTitle.toLowerCase();
      return title.startsWith(needle) || artist.startsWith(needle);
    });
  }, [filterValue, favourites]);

  const loadMore = useCallback(async (offset: number) => {
    if (!isAuthenticated || pathname !== "/favourites") {
      return;
    }

    if (requestedOffsetsRef.current.has(offset) || isLoadingMore || !hasMore) {
      return;
    }

    requestedOffsetsRef.current.add(offset);
    setIsLoadingMore(true);
    setLoadError(null);

    try {
      const response = await fetchWithAuthRetry(
        `/api/favourites?limit=${FAVOURITES_BATCH_SIZE}&offset=${offset}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

      if (!response.ok) {
        requestedOffsetsRef.current.delete(offset);
        setLoadError("Could not load more favourites. Please try again.");
        return;
      }

      const payload = (await response.json().catch(() => null)) as FavouritesPayload | null;
      const incoming = Array.isArray(payload?.favourites) ? payload.favourites : [];

      setFavourites((current) => {
        const seen = new Set(current.map((video) => video.id));
        const uniqueIncoming = incoming.filter((video) => !seen.has(video.id));

        if (uniqueIncoming.length === 0) {
          return current;
        }

        return [...current, ...uniqueIncoming];
      });

      if (typeof payload?.totalCount === "number" && Number.isFinite(payload.totalCount)) {
        setTotalCount(Math.max(0, Math.floor(payload.totalCount)));
      }

      const nextOffset = Number(payload?.nextOffset);
      nextOffsetRef.current = Number.isFinite(nextOffset)
        ? Math.max(offset + incoming.length, Math.floor(nextOffset))
        : offset + incoming.length;

      if (typeof payload?.hasMore === "boolean") {
        setHasMore(payload.hasMore);
      } else {
        setHasMore(incoming.length === FAVOURITES_BATCH_SIZE);
      }
    } catch {
      requestedOffsetsRef.current.delete(offset);
      setLoadError("Could not load more favourites. Please try again.");
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, isAuthenticated, isLoadingMore, pathname]);

  useEffect(() => {
    if (!isAuthenticated || pathname !== "/favourites") {
      return;
    }

    let isCancelled = false;

    async function refreshFavourites() {
      try {
        const response = await fetchWithAuthRetry(
          `/api/favourites?limit=${FAVOURITES_BATCH_SIZE}&offset=0`,
          {
          method: "GET",
          cache: "no-store",
          },
        );

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as FavouritesPayload | null;
        const windowFavourites = Array.isArray(payload?.favourites) ? payload.favourites : [];
        const nextOffset = Number(payload?.nextOffset);
        const nextTotalCount =
          typeof payload?.totalCount === "number" && Number.isFinite(payload.totalCount)
            ? Math.max(0, Math.floor(payload.totalCount))
            : windowFavourites.length;

        if (!isCancelled) {
          setFavourites(windowFavourites);
          setTotalCount(nextTotalCount);
          setHasMore(typeof payload?.hasMore === "boolean" ? payload.hasMore : windowFavourites.length < nextTotalCount);
          requestedOffsetsRef.current.clear();
          nextOffsetRef.current = Number.isFinite(nextOffset)
            ? Math.max(windowFavourites.length, Math.floor(nextOffset))
            : windowFavourites.length;
          setLoadError(null);
        }
      } catch {
        // Keep the initial server-provided favourites if refresh fails.
      }
    }

    void refreshFavourites();

    const handleFavouritesUpdated = () => {
      void refreshFavourites();
    };

    const unsubscribe = listenToAppEvent(EVENT_NAMES.FAVOURITES_UPDATED, handleFavouritesUpdated);

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }, [isAuthenticated, pathname]);

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
        rootMargin: "700px 0px",
        threshold: 0,
      },
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, loadMore]);

  const removeFavourite = useCallback((videoId: string) => {
    if (!isAuthenticated) {
      setMessage("Sign in to manage favourites.");
      return;
    }

    startTransition(async () => {
      setPendingVideoId(videoId);
      setMessage(null);

      try {
        const response = await fetchWithAuthRetry("/api/favourites", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            videoId,
            action: "remove",
          }),
        });

        if (response.status === 401 || response.status === 403) {
          setMessage("Sign in to manage favourites.");
          return;
        }

        if (!response.ok) {
          setMessage("Could not remove favourite. Please try again.");
          return;
        }

        setFavourites((current) => current.filter((track) => track.id !== videoId));
        setTotalCount((current) => Math.max(0, current - 1));
        dispatchAppEvent(EVENT_NAMES.FAVOURITES_UPDATED, null);
        setMessage("Track removed from favourites.");
      } catch {
        setMessage("Could not remove favourite. Please try again.");
      } finally {
        setPendingVideoId(null);
      }
    });
  }, [isAuthenticated, startTransition]);

  const openVideo = useCallback((videoId: string) => {
    router.push(`/?v=${encodeURIComponent(videoId)}&resume=1`);
  }, [router]);

  async function createPlaylistFromFavourites() {
    let sourceFavourites = favourites;

    if (hasMore) {
      try {
        const response = await fetchWithAuthRetry("/api/favourites", {
          method: "GET",
          cache: "no-store",
        });

        if (response.ok) {
          const payload = (await response.json().catch(() => null)) as FavouritesPayload | null;
          if (Array.isArray(payload?.favourites) && payload.favourites.length > 0) {
            sourceFavourites = payload.favourites;
            setFavourites(payload.favourites);
            setTotalCount(payload.favourites.length);
            setHasMore(false);
            requestedOffsetsRef.current.clear();
            nextOffsetRef.current = payload.favourites.length;
          }
        }
      } catch {
        // Fall back to the currently loaded favourites if full refresh fails.
      }
    }

    setIsCreatingPlaylistFromFavourites(true);

    const playlistName = `Favourites ${new Date().toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`;

    try {
      await createPlaylistFromVideoList({
        isAuthenticated,
        sourceVideos: sourceFavourites,
        playlistName,
        router,
        currentVideoId: searchParams.get("v"),
        telemetryComponent: "favourites-grid",
        setStatus: setMessage,
        emptyMessage: "No favourites available to add.",
        createFailedMessage: "Could not create playlist from favourites. Please try again.",
        optimisticMode: {
          kind: "staggered",
          reconcileOnlyWhenChanged: true,
        },
        dispatchCreationProgressDone: true,
        onBuildSuccessMessage: ({ playlistName: finalName, addedCount, requestedCount }) => {
          if (addedCount < requestedCount) {
            return `Created playlist "${finalName}" with ${addedCount}/${requestedCount} tracks.`;
          }

          return `Created playlist "${finalName}" with all ${addedCount} favourites.`;
        },
      });
    } finally {
      setIsCreatingPlaylistFromFavourites(false);
    }
  }

  return (
    <>
      <OverlayHeader className="categoriesHeaderBar" close={false}>
        <div className="categoriesHeaderMain">
          <strong><span className="whiteHeart" aria-hidden="true">❤️</span> Favourites ({totalCount})</strong>
          <div className="categoriesFilterBar">
            <input
              type="text"
              className="categoriesFilterInput"
              placeholder="type to filter..."
              value={filterValue}
              onChange={(event) => setFilterValue(event.target.value)}
              aria-label="Filter favourites by prefix"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="categoriesHeaderActions">
            {isAuthenticated ? (
              <button
                type="button"
                className="newPageSeenToggle favouritesCreatePlaylistButton"
                onClick={() => {
                  void createPlaylistFromFavourites();
                }}
                disabled={totalCount === 0 || isCreatingPlaylistFromFavourites}
              >
                  {isCreatingPlaylistFromFavourites ? "+ Creating..." : "+ New Playlist"}
              </button>
            ) : null}
          </div>
        </div>
        <CloseLink />
      </OverlayHeader>

      {filteredFavourites.length > 0 ? (
        <>
          <div className="catalogGrid favouritesCatalogGrid">
            {filteredFavourites.map((track) => {
              const isRemoving = pendingVideoId === track.id;

              return (
                <FavouritesGridCard
                  key={track.id}
                  track={track}
                  isAuthenticated={isAuthenticated}
                  isPending={isPending}
                  isRemoving={isRemoving}
                  isCreatingPlaylistFromFavourites={isCreatingPlaylistFromFavourites}
                  onOpenVideo={openVideo}
                  onRemoveFavourite={removeFavourite}
                />
              );
            })}
          </div>
          {loadError ? (
            <div className="favouritesEmptyState" role="status" aria-live="polite">
              <p>{loadError}</p>
              <button
                type="button"
                className="newPageSeenToggle"
                onClick={() => {
                  void loadMore(nextOffsetRef.current);
                }}
                disabled={isLoadingMore || !hasMore}
              >
                Retry
              </button>
            </div>
          ) : null}
          {isLoadingMore ? <p className="mutationMessage">Loading more favourites...</p> : null}
          {hasMore ? <div ref={sentinelRef} aria-hidden="true" /> : null}
        </>
      ) : (
        <div className="favouritesEmptyState" role="status" aria-live="polite">
          {totalCount > 0 ? (
            <>
              <h3>No favourites match that prefix.</h3>
              <p>Try a shorter starting string.</p>
            </>
          ) : (
            <>
              <h3>There are no favourites saved yet.</h3>
              <p>Save tracks with the heart button to build your favourites list.</p>
            </>
          )}
        </div>
      )}

      {message ? <p className="mutationMessage">{message}</p> : null}
    </>
  );
}
