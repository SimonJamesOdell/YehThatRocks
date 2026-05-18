"use client";

import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import { inferArtistFromTitle } from "@/lib/catalog-metadata-utils";
import type { VideoRecord } from "@/lib/catalog";
import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";
import { EVENT_NAMES, FAVOURITES_CREATE_PLAYLIST_FINISHED_EVENT, FAVOURITES_CREATE_PLAYLIST_REQUESTED_EVENT, dispatchAppEvent, listenToAppEvent } from "@/lib/events-contract";
import { createPlaylistFromVideoList } from "@/lib/playlist-create-from-video-list";
import { parseJsonOrNull } from "@/lib/parse-json";
import { getArtistPagePath } from "@/lib/artist-routing";

const FAVOURITES_BATCH_SIZE = 100;
const artistVideoCountCache = new Map<string, number | null>();
const artistVideoCountInFlight = new Map<string, Promise<number | null>>();

function inferTrackFromTitle(title: string, artist: string) {
  const trimmedTitle = title.trim();
  const trimmedArtist = artist.trim();
  if (!trimmedTitle || !trimmedArtist) {
    return trimmedTitle;
  }

  const separators = [" - ", " — ", " | "];
  for (const separator of separators) {
    const split = trimmedTitle.split(separator).map((part) => part.trim()).filter(Boolean);
    if (split.length < 2) {
      continue;
    }

    const [left, right] = split;
    if (left.toLowerCase() === trimmedArtist.toLowerCase()) {
      return right;
    }

    if (right.toLowerCase() === trimmedArtist.toLowerCase()) {
      return left;
    }
  }

  return trimmedTitle;
}

function inferArtistTrackFromTitleFallback(title: string) {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return { artist: "", track: "" };
  }

  const separators = [" - ", " — ", " | "];
  for (const separator of separators) {
    const split = trimmedTitle.split(separator).map((part) => part.trim()).filter(Boolean);
    if (split.length >= 2) {
      return { artist: split[0] ?? "", track: split.slice(1).join(separator) };
    }
  }

  return { artist: "", track: "" };
}

async function fetchArtistVideoCount(artistSlug: string, videoId: string): Promise<number | null> {
  const cacheKey = `${artistSlug}:${videoId}`;
  if (artistVideoCountCache.has(cacheKey)) {
    return artistVideoCountCache.get(cacheKey) ?? null;
  }

  const existing = artistVideoCountInFlight.get(cacheKey);
  if (existing) {
    return existing;
  }

  const request = (async () => {
    try {
      const query = new URLSearchParams();
      query.set("v", videoId);
      const response = await fetch(`/api/artists/${encodeURIComponent(artistSlug)}?${query.toString()}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        artistVideoCountCache.set(cacheKey, null);
        return null;
      }

      const payload = await response.json() as {
        videoCount?: number | null;
        videos?: Array<{ id?: string }>;
      };

      const resolvedCount = Number(payload?.videoCount);
      const fallbackCount = Array.isArray(payload?.videos) ? payload.videos.length : null;
      const count = Number.isFinite(resolvedCount) ? resolvedCount : fallbackCount;
      artistVideoCountCache.set(cacheKey, count);
      return count;
    } catch {
      artistVideoCountCache.set(cacheKey, null);
      return null;
    } finally {
      artistVideoCountInFlight.delete(cacheKey);
    }
  })();

  artistVideoCountInFlight.set(cacheKey, request);
  return request;
}

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
  onOpenArtistPage: (artistPagePath: string, videoId: string) => void;
  onRemoveFavourite: (videoId: string) => void;
};

const FavouritesGridCard = memo(function FavouritesGridCard({
  track,
  isAuthenticated,
  isPending,
  isRemoving,
  isCreatingPlaylistFromFavourites,
  onOpenVideo,
  onOpenArtistPage,
  onRemoveFavourite,
}: FavouritesGridCardProps) {
  const [artistVideoCount, setArtistVideoCount] = useState<number | null>(null);
  const rawDisplayTitle = track.title;
  const fallbackArtistTrack = inferArtistTrackFromTitleFallback(rawDisplayTitle);
  const parsedArtistCandidate =
    track.parsedArtist?.trim()
    || track.channelTitle?.trim()
    || inferArtistFromTitle(rawDisplayTitle)?.trim()
    || fallbackArtistTrack.artist.trim()
    || "";
  const metadataArtist = parsedArtistCandidate || "Unknown Artist";
  const parsedTrackCandidate =
    track.parsedTrack?.trim()
    || inferTrackFromTitle(rawDisplayTitle, metadataArtist)
    || fallbackArtistTrack.track.trim()
    || "";
  const parsedArtistLabel = parsedArtistCandidate.toUpperCase();
  const displayTitle = parsedArtistCandidate && parsedTrackCandidate
    ? `${parsedArtistLabel} - ${parsedTrackCandidate}`
    : rawDisplayTitle;
  const parsedArtistPagePath = parsedArtistCandidate ? getArtistPagePath(parsedArtistCandidate) : null;
  const artistSlug = parsedArtistPagePath?.split("/")[2] ?? null;
  const artistVideoCountLabel = artistVideoCount === null
    ? null
    : `${artistVideoCount.toLocaleString("en-US")} videos`;

  useEffect(() => {
    if (!artistSlug) {
      setArtistVideoCount(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const count = await fetchArtistVideoCount(artistSlug, track.id);
      if (!cancelled) {
        setArtistVideoCount(count);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [artistSlug, track.id]);

  const handleOpenArtistPage = useCallback((event: React.MouseEvent<HTMLSpanElement>) => {
    if (!parsedArtistPagePath) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onOpenArtistPage(parsedArtistPagePath, track.id);
  }, [onOpenArtistPage, parsedArtistPagePath, track.id]);

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
        <div
          className="favouritesPlaylistOverlayButtonWrap"
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
      <div className="relatedCardSourceBadges artistVideoSourceBadges">
        {track.isFavouriteSource ? <span className="relatedSourceBadge relatedSourceBadgeFavourite">Favourite</span> : null}
        {track.isTop100Source ? <span className="relatedSourceBadge relatedSourceBadgeTop100">Top100</span> : null}
        {track.isNewSource ? <span className="relatedSourceBadge relatedSourceBadgeNew">New</span> : null}
      </div>
      <h3>
        <span className="cardTitleLink">
          {parsedArtistCandidate && parsedTrackCandidate ? (
            <>
              <span
                className={parsedArtistPagePath ? "leaderboardParsedArtistLink" : undefined}
                onClick={handleOpenArtistPage}
              >
                {parsedArtistLabel}
              </span>
              <span aria-hidden="true"> - </span>
              <span>{parsedTrackCandidate}</span>
            </>
          ) : displayTitle}
        </span>
      </h3>
      {artistVideoCountLabel ? <p className="leaderboardArtistVideoCount">{artistVideoCountLabel}</p> : null}
    </article>
  );
});

export function FavouritesGrid({
  initialFavourites,
  initialTotalCount,
  isAuthenticated,
}: FavouritesGridProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const hydrationRunRef = useRef(0);
  const [favourites, setFavourites] = useState<VideoRecord[]>(initialFavourites);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [isHydratingFavourites, setIsHydratingFavourites] = useState(false);
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const [pendingVideoId, setPendingVideoId] = useState<string | null>(null);
  const [isCreatingPlaylistFromFavourites, setIsCreatingPlaylistFromFavourites] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const deferredFilter = useDeferredValue((searchParams.get("f") ?? "").trim().toLowerCase());

  const loadAllFavouritesInChunks = useCallback(async () => {
    if (!isAuthenticated || pathname !== "/favourites") {
      return null;
    }

    const runId = hydrationRunRef.current + 1;
    hydrationRunRef.current = runId;
    setIsHydratingFavourites(true);
    setHydrationError(null);

    const seenIds = new Set<string>();
    const collected: VideoRecord[] = [];
    let offset = 0;
    let knownTotal = 0;

    try {
      while (true) {
        const response = await fetchWithAuthRetry(
          `/api/favourites?limit=${FAVOURITES_BATCH_SIZE}&offset=${offset}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

        if (runId !== hydrationRunRef.current) {
          return null;
        }

        if (!response.ok) {
          throw new Error("favourites-load-failed");
        }

        const payload = (await parseJsonOrNull(response)) as FavouritesPayload | null;
        const incoming = Array.isArray(payload?.favourites) ? payload.favourites : [];
        const hasMore =
          typeof payload?.hasMore === "boolean"
            ? payload.hasMore
            : incoming.length === FAVOURITES_BATCH_SIZE;

        if (typeof payload?.totalCount === "number" && Number.isFinite(payload.totalCount)) {
          knownTotal = Math.max(0, Math.floor(payload.totalCount));
        }

        for (const video of incoming) {
          if (seenIds.has(video.id)) {
            continue;
          }

          seenIds.add(video.id);
          collected.push(video);
        }

        if (runId !== hydrationRunRef.current) {
          return null;
        }

        setFavourites([...collected]);
        setTotalCount(Math.max(knownTotal, collected.length));

        if (!hasMore || incoming.length === 0) {
          break;
        }

        const nextOffset = Number(payload?.nextOffset);
        offset = Number.isFinite(nextOffset)
          ? Math.max(offset + incoming.length, Math.floor(nextOffset))
          : offset + incoming.length;
      }

      return collected;
    } catch {
      if (runId === hydrationRunRef.current) {
        setHydrationError("Could not load your full favourites list. Please retry.");
      }
      return null;
    } finally {
      if (runId === hydrationRunRef.current) {
        setIsHydratingFavourites(false);
      }
    }
  }, [isAuthenticated, pathname]);

  const filteredFavourites = useMemo(() => {
    if (!deferredFilter) {
      return favourites;
    }

    return favourites.filter((track) => {
      const title = track.title.toLowerCase();
      const artist = track.channelTitle.toLowerCase();
      return title.includes(deferredFilter) || artist.includes(deferredFilter);
    });
  }, [deferredFilter, favourites]);

  useEffect(() => {
    if (!isAuthenticated || pathname !== "/favourites") {
      return;
    }

    void loadAllFavouritesInChunks();

    const handleFavouritesUpdated = () => {
      void loadAllFavouritesInChunks();
    };

    const unsubscribe = listenToAppEvent(EVENT_NAMES.FAVOURITES_UPDATED, handleFavouritesUpdated);

    return () => {
      hydrationRunRef.current += 1;
      unsubscribe();
    };
  }, [isAuthenticated, loadAllFavouritesInChunks, pathname]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const unsubscribe = listenToAppEvent(FAVOURITES_CREATE_PLAYLIST_REQUESTED_EVENT, () => {
      void createPlaylistFromFavourites();
    });

    return () => {
      unsubscribe();
    };
  }, [createPlaylistFromFavourites, isAuthenticated]);

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

  const openArtistPageFromFavourites = useCallback((artistPagePath: string, videoId: string) => {
    const returnToParams = new URLSearchParams(searchParams.toString());
    returnToParams.set("v", videoId);
    returnToParams.set("resume", "1");
    const returnTo = returnToParams.toString() ? `${pathname}?${returnToParams.toString()}` : pathname;
    const artistParams = new URLSearchParams();
    artistParams.set("from", "favourites");
    artistParams.set("returnTo", returnTo);
    artistParams.set("v", videoId);
    router.push(`${artistPagePath}?${artistParams.toString()}`);
  }, [pathname, router, searchParams]);

  async function createPlaylistFromFavourites() {
    let sourceFavourites = favourites;

    const latestFavourites = await loadAllFavouritesInChunks();
    if (Array.isArray(latestFavourites) && latestFavourites.length > 0) {
      sourceFavourites = latestFavourites;
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
      dispatchAppEvent(FAVOURITES_CREATE_PLAYLIST_FINISHED_EVENT, null);
    }
  }

  return (
    <>
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
                  onOpenArtistPage={openArtistPageFromFavourites}
                  onRemoveFavourite={removeFavourite}
                />
              );
            })}
          </div>
          {hydrationError ? (
            <div className="favouritesEmptyState" role="status" aria-live="polite">
              <p>{hydrationError}</p>
              <button
                type="button"
                className="newPageSeenToggle"
                onClick={() => {
                  void loadAllFavouritesInChunks();
                }}
                disabled={isHydratingFavourites}
              >
                Retry
              </button>
            </div>
          ) : null}
          {isHydratingFavourites && favourites.length < totalCount ? (
            <p className="mutationMessage">Loading favourites {favourites.length}/{totalCount}...</p>
          ) : null}
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
