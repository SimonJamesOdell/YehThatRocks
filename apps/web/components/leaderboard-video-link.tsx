"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";

import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import { SearchResultFavouriteButton } from "@/components/search-result-favourite-button";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import { inferArtistFromTitle } from "@/lib/catalog-metadata-utils";
import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";
import { dispatchAppEvent, EVENT_NAMES } from "@/lib/events-contract";
import { useLiveSearchParams } from "@/components/use-live-search-params";
import { getArtistPagePath } from "@/lib/artist-routing";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { navigateVideoHref } from "@/components/player-video-navigation";
import { resolveLeaderboardVideoLinkNavigationAction } from "@/components/leaderboard-video-link-navigation";
import { shouldShowLeaderboardVideoArtistCount } from "@/components/leaderboard-video-link-display";
import { PENDING_VIDEO_SELECTION_KEY } from "@/lib/storage-keys";

type LeaderboardVideoLinkProps = {
  track: {
    id: string;
    title: string;
    channelTitle: string;
    parsedArtist?: string | null;
    parsedTrack?: string | null;
    genre: string;
    favourited: number;
    description: string;
    thumbnail?: string | null;
  };
  index: number;
  isAuthenticated?: boolean;
  isSeen?: boolean;
  isActive?: boolean;
  rowVariant?: "default" | "new";
  onHideVideo?: (track: LeaderboardVideoLinkProps["track"]) => void;
  isHidePending?: boolean;
  onFlagVideo?: (track: LeaderboardVideoLinkProps["track"]) => void;
  isFlagPending?: boolean;
};

const TOP100_WARM_WINDOW_MS = 12_000;
const TOP100_WARM_LIMIT_PER_WINDOW = 6;
const TOP100_VIDEO_WARM_TTL_MS = 25_000;
let top100WarmWindowStartedAt = 0;
let top100WarmCountInWindow = 0;
const top100WarmByVideoId = new Map<string, number>();
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

function canWarmTop100Selection() {
  const now = Date.now();
  if (top100WarmWindowStartedAt === 0 || now - top100WarmWindowStartedAt > TOP100_WARM_WINDOW_MS) {
    top100WarmWindowStartedAt = now;
    top100WarmCountInWindow = 0;
  }

  if (top100WarmCountInWindow >= TOP100_WARM_LIMIT_PER_WINDOW) {
    return false;
  }

  top100WarmCountInWindow += 1;
  return true;
}

function canWarmTop100Video(videoId: string) {
  const now = Date.now();
  const warmExpiresAt = top100WarmByVideoId.get(videoId) ?? 0;

  if (warmExpiresAt > now) {
    return false;
  }

  top100WarmByVideoId.set(videoId, now + TOP100_VIDEO_WARM_TTL_MS);
  return true;
}

export function LeaderboardVideoLink({
  track,
  index,
  isAuthenticated = true,
  isSeen = false,
  isActive = false,
  rowVariant = "default",
  onHideVideo,
  isHidePending = false,
  onFlagVideo,
  isFlagPending = false,
}: LeaderboardVideoLinkProps) {
  const isNewRow = rowVariant === "new";
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useLiveSearchParams();
  const hasWarmedRef = useRef(false);
  const clickFlashTimeoutRef = useRef<number | null>(null);
  const [isClickFlashing, setIsClickFlashing] = useState(false);
  const [isFavourited, setIsFavourited] = useState(Number(track.favourited ?? 0) > 0);
  const [isRemovingFavourite, setIsRemovingFavourite] = useState(false);
  const [artistVideoCount, setArtistVideoCount] = useState<number | null>(null);
  const hideButtonContextLabel = rowVariant === "new" ? "New" : "Top 100";
  const rawDisplayTitle = track.title;
  const parsedArtistCandidate =
    track.parsedArtist?.trim()
    || track.channelTitle?.trim()
    || inferArtistFromTitle(rawDisplayTitle)?.trim()
    || "";
  const metadataArtist = parsedArtistCandidate || "Unknown Artist";
  const parsedTrackCandidate =
    track.parsedTrack?.trim()
    || inferTrackFromTitle(rawDisplayTitle, metadataArtist)
    || "";
  const parsedArtistLabel = parsedArtistCandidate.toUpperCase();
  const displayTitle = parsedArtistCandidate && parsedTrackCandidate
    ? `${parsedArtistLabel} - ${parsedTrackCandidate}`
    : rawDisplayTitle;
  const artistPagePath = getArtistPagePath(metadataArtist);
  const parsedArtistPagePath = parsedArtistCandidate ? getArtistPagePath(parsedArtistCandidate) : null;
  const artistSlug = artistPagePath?.split("/")[2] ?? null;
  const artistVideoCountLabel = rowVariant === "new" || artistVideoCount === null
    ? null
    : `${artistVideoCount.toLocaleString("en-US")} videos`;

  const videoHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("v", track.id);
    params.set("resume", "1");
    return `${pathname}?${params.toString()}`;
  }, [pathname, searchParams, track.id]);

  useEffect(() => {
    return () => {
      if (clickFlashTimeoutRef.current !== null) {
        window.clearTimeout(clickFlashTimeoutRef.current);
        clickFlashTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setIsFavourited(Number(track.favourited ?? 0) > 0);
  }, [track.id, track.favourited]);

  useEffect(() => {
    if (!shouldShowLeaderboardVideoArtistCount(rowVariant)) {
      setArtistVideoCount(null);
      return;
    }

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
  }, [artistSlug, rowVariant, track.id]);

  const triggerClickFlash = useCallback(() => {
    setIsClickFlashing(true);
    if (clickFlashTimeoutRef.current !== null) {
      window.clearTimeout(clickFlashTimeoutRef.current);
    }

    clickFlashTimeoutRef.current = window.setTimeout(() => {
      setIsClickFlashing(false);
      clickFlashTimeoutRef.current = null;
    }, 220);
  }, []);

  const stagePendingSelection = useCallback(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        PENDING_VIDEO_SELECTION_KEY,
        JSON.stringify({
          id: track.id,
          title: track.title,
          channelTitle: track.channelTitle,
          genre: track.genre,
          favourited: track.favourited,
          description: track.description,
        }),
      );
    }

    return true;
  }, [track]);

  const warmSelection = useCallback(() => {
    triggerClickFlash();
    stagePendingSelection();
    if (hasWarmedRef.current) {
      return;
    }

    if (!canWarmTop100Selection()) {
      return;
    }

    if (!canWarmTop100Video(track.id)) {
      return;
    }

    hasWarmedRef.current = true;
    void fetch(`/api/current-video?v=${encodeURIComponent(track.id)}`, {
      cache: "no-store",
    }).catch(() => undefined);
  }, [stagePendingSelection, track.id, triggerClickFlash]);

  const navigateToVideo = useCallback(() => {
    if (rowVariant === "new") {
      triggerClickFlash();
      stagePendingSelection();
    } else {
      warmSelection();
    }

    const navigationAction = resolveLeaderboardVideoLinkNavigationAction({
      rowVariant,
      videoId: track.id,
      href: videoHref,
    });

    if (navigationAction.kind === "dispatch-manual-navigation-request") {
      dispatchAppEvent(EVENT_NAMES.MANUAL_VIDEO_NAVIGATION_REQUEST, {
        videoId: navigationAction.videoId,
      });

      // Fallback for rare listener timing issues: if dispatch did not
      // result in a URL update, navigate directly so selection is never dropped.
      if (typeof window !== "undefined") {
        const selectedVideoId = new URLSearchParams(window.location.search).get("v");
        if (selectedVideoId !== navigationAction.videoId) {
          navigateVideoHref({
            href: videoHref,
            useNativeHistory: true,
            routerPush: (href) => {
              router.push(href, { scroll: false });
            },
          });
        }
      }

      return;
    }

    navigateVideoHref({
      href: navigationAction.href,
      useNativeHistory: true,
      routerPush: (href) => {
        router.push(href, { scroll: false });
      },
    });
  }, [router, rowVariant, stagePendingSelection, track.id, triggerClickFlash, videoHref, warmSelection]);

  const openVideoFromCard = useCallback(() => {
    navigateToVideo();
  }, [navigateToVideo]);

  const handleNewRowActivation = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.defaultPrevented) {
      return;
    }

    const target = event.target;
    if (target instanceof Element && target.closest("button, a, input, select, textarea, label")) {
      return;
    }

    const isPrimaryButton = event.button === 0 || event.button === undefined;
    if (!isPrimaryButton || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      if (typeof window !== "undefined") {
        window.open(videoHref, "_blank", "noopener,noreferrer");
      }
      return;
    }

    event.preventDefault();
    openVideoFromCard();
  }, [openVideoFromCard, videoHref]);

  const handleOpenParsedArtistPage = useCallback((event: ReactMouseEvent<HTMLSpanElement>) => {
    if (!parsedArtistPagePath) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (rowVariant === "new" || rowVariant === "default") {
      const params = new URLSearchParams();
      params.set("from", rowVariant === "new" ? "new" : "top100");
      params.set("returnTo", videoHref);
      router.push(`${parsedArtistPagePath}?${params.toString()}`);
      return;
    }

    router.push(parsedArtistPagePath);
  }, [parsedArtistPagePath, router, rowVariant, videoHref]);

  const handleOpenParsedArtistPageByKeyboard = useCallback((event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (!parsedArtistPagePath) {
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (rowVariant === "new" || rowVariant === "default") {
      const params = new URLSearchParams();
      params.set("from", rowVariant === "new" ? "new" : "top100");
      params.set("returnTo", videoHref);
      router.push(`${parsedArtistPagePath}?${params.toString()}`);
      return;
    }

    router.push(parsedArtistPagePath);
  }, [parsedArtistPagePath, router, rowVariant, videoHref]);

  const handleRemoveFavourite = useCallback(async (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (!isAuthenticated || isRemovingFavourite) {
      return;
    }

    setIsRemovingFavourite(true);

    try {
      const response = await fetchWithAuthRetry("/api/favourites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: track.id, action: "remove" }),
      });

      if (!response.ok) {
        return;
      }

      setIsFavourited(false);
      dispatchAppEvent(EVENT_NAMES.FAVOURITES_UPDATED, null);
    } finally {
      setIsRemovingFavourite(false);
    }
  }, [isAuthenticated, isRemovingFavourite, track.id]);

  const cardBody = (
    <>
      <div className="leaderboardRank">#{index + 1}</div>
      <div className="leaderboardThumbWrap" data-video-id={track.id}>
        <YouTubeThumbnailImage
          videoId={track.id}
          alt=""
          className="leaderboardThumb"
          loading="lazy"
          fetchPriority="auto"
          reportReason="thumbnail-load-error:top100"
        />
        {isSeen && !isFavourited ? <span className="videoSeenBadge videoSeenBadgeOverlay">Seen</span> : null}
        {isFavourited ? (
          <button
            type="button"
            className="relatedFavouriteBadgeOverlay top100FavouriteBadgeOverlay artistVideoFavouriteBadgeButton"
            aria-label={`Remove ${track.title} from favourites`}
            title="Remove from favourites"
            disabled={isRemovingFavourite}
            onClick={handleRemoveFavourite}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <span className="artistVideoFavouriteBadgeHeart" aria-hidden="true">♥</span>
            <span className="artistVideoFavouriteBadgeRemoveGlyph" aria-hidden="true">x</span>
          </button>
        ) : null}
      </div>
      <div className="leaderboardMeta">
        <h3>
          {parsedArtistCandidate && parsedTrackCandidate ? (
            <>
              <ArtistWikiLink artistName={track.channelTitle} videoId={track.id} className="artistInlineLink">
                <span
                  role={parsedArtistPagePath ? "link" : undefined}
                  tabIndex={parsedArtistPagePath ? 0 : undefined}
                  onClick={handleOpenParsedArtistPage}
                  onKeyDown={handleOpenParsedArtistPageByKeyboard}
                >
                  {parsedArtistLabel}
                </span>
              </ArtistWikiLink>
              <span aria-hidden="true"> - </span>
              <span>{parsedTrackCandidate}</span>
            </>
          ) : displayTitle}
        </h3>
        {artistVideoCountLabel ? (
          <p className="leaderboardArtistVideoCount">{artistVideoCountLabel}</p>
        ) : null}
      </div>
    </>
  );

  return (
    <article
      className={`trackCard leaderboardCard top100CardWithPlaylistAction${isSeen ? " top100CardSeen" : ""}${isSeen && rowVariant === "new" ? " top100CardSeenNew" : ""}${isActive ? " top100CardActive" : ""}${isClickFlashing ? " top100CardClickFlash" : ""}${isAuthenticated ? " top100CardCornerActions" : ""}${rowVariant === "new" ? " top100CardNewPersistentActions" : ""}${rowVariant === "default" ? " top100CardAlwaysVisibleControls" : ""}`}
      role="link"
      tabIndex={0}
      aria-label={`Play ${track.title}`}
      onClick={(event) => {
        if (isNewRow) {
          handleNewRowActivation(event);
          return;
        }

        if (event.defaultPrevented) {
          return;
        }

        const target = event.target;
        if (target instanceof Element && target.closest("a")) {
          return;
        }

        openVideoFromCard();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();

        if (isNewRow) {
          openVideoFromCard();
          return;
        }

        openVideoFromCard();
      }}
    >
      {isAuthenticated && onHideVideo ? (
        <button
          type="button"
          className="top100CardHideButton"
          aria-label={`Hide ${track.title} from ${hideButtonContextLabel}`}
          title={`Hide from ${hideButtonContextLabel}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onHideVideo(track);
          }}
          disabled={isHidePending}
        >
          ×
        </button>
      ) : null}
      {isAuthenticated && onFlagVideo ? (
        <button
          type="button"
          className="top100CardFlagButton"
          aria-label={`Flag ${track.title} for quality review`}
          title="Flag for quality review"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onFlagVideo(track);
          }}
          disabled={isFlagPending}
        >
          ⚑
        </button>
      ) : null}
      {isNewRow ? (
        <div
          className="linkedCard leaderboardTrackLink"
          data-overlay-capture-skip="true"
          aria-current={isActive ? "true" : undefined}
        >
          {cardBody}
        </div>
      ) : (
        <Link
          href={videoHref}
          className="linkedCard leaderboardTrackLink"
          data-overlay-capture-skip="true"
          prefetch={false}
          aria-current={isActive ? "true" : undefined}
          onMouseEnter={stagePendingSelection}
          onFocus={stagePendingSelection}
          onPointerDown={warmSelection}
          onClick={(event) => {
            if (event.defaultPrevented) {
              return;
            }

            event.preventDefault();

            const isPrimaryButton = event.button === 0 || event.button === undefined;
            if (!isPrimaryButton || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
              if (typeof window !== "undefined") {
                window.open(videoHref, "_blank", "noopener,noreferrer");
              }
              return;
            }

            navigateToVideo();
          }}
        >
          {cardBody}
        </Link>
      )}
      <div className="top100CardAction">
        {!isFavourited ? (
          <div
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <SearchResultFavouriteButton
              videoId={track.id}
              title={track.title}
              isAuthenticated={isAuthenticated}
              className="top100CardFavouriteButton"
              onSaved={() => setIsFavourited(true)}
            />
          </div>
        ) : null}
        <div
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <AddToPlaylistButton
            videoId={track.id}
            isAuthenticated={isAuthenticated}
            compact
            className="top100CardPlaylistAddButton"
          />
        </div>
      </div>
    </article>
  );
}
