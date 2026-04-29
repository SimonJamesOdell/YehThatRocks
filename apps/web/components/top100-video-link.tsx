"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { SearchResultFavouriteButton } from "@/components/search-result-favourite-button";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";

type Top100VideoLinkProps = {
  track: {
    id: string;
    title: string;
    channelTitle: string;
    genre: string;
    favourited: number;
    description: string;
    thumbnail?: string | null;
  };
  index: number;
  isAuthenticated?: boolean;
  isSeen?: boolean;
  rowVariant?: "default" | "new";
  onHideVideo?: (track: Top100VideoLinkProps["track"]) => void;
  isHidePending?: boolean;
  onFlagVideo?: (track: Top100VideoLinkProps["track"]) => void;
  isFlagPending?: boolean;
};

const PENDING_VIDEO_SELECTION_KEY = "ytr:pending-video-selection";
const TOP100_WARM_WINDOW_MS = 12_000;
const TOP100_WARM_LIMIT_PER_WINDOW = 6;
const TOP100_VIDEO_WARM_TTL_MS = 25_000;
let top100WarmWindowStartedAt = 0;
let top100WarmCountInWindow = 0;
const top100WarmByVideoId = new Map<string, number>();

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

export function Top100VideoLink({
  track,
  index,
  isAuthenticated = true,
  isSeen = false,
  rowVariant = "default",
  onHideVideo,
  isHidePending = false,
  onFlagVideo,
  isFlagPending = false,
}: Top100VideoLinkProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const hasWarmedRef = useRef(false);
  const clickFlashTimeoutRef = useRef<number | null>(null);
  const [isClickFlashing, setIsClickFlashing] = useState(false);
  const [isFavourited, setIsFavourited] = useState(Number(track.favourited ?? 0) > 0);
  const [isRemovingFavourite, setIsRemovingFavourite] = useState(false);
  const hideButtonContextLabel = rowVariant === "new" ? "New" : "Top 100";

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

  const openVideoFromCard = useCallback(() => {
    warmSelection();
    router.push(videoHref);
  }, [router, videoHref, warmSelection]);

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
      window.dispatchEvent(new Event("ytr:favourites-updated"));
    } finally {
      setIsRemovingFavourite(false);
    }
  }, [isAuthenticated, isRemovingFavourite, track.id]);

  return (
    <article
      className={`trackCard leaderboardCard top100CardWithPlaylistAction${isSeen ? " top100CardSeen" : ""}${isSeen && rowVariant === "new" ? " top100CardSeenNew" : ""}${isClickFlashing ? " top100CardClickFlash" : ""}${isAuthenticated ? " top100CardCornerActions" : ""}${rowVariant === "new" ? " top100CardNewPersistentActions" : ""}${rowVariant === "default" ? " top100CardAlwaysVisibleControls" : ""}`}
      role="link"
      tabIndex={0}
      aria-label={`Play ${track.title}`}
      onClick={(event) => {
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
      <Link
        href={videoHref}
        className="linkedCard leaderboardTrackLink"
        prefetch={false}
        onMouseEnter={stagePendingSelection}
        onFocus={stagePendingSelection}
        onPointerDown={warmSelection}
        onClick={warmSelection}
      >
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
          <h3>{track.title}</h3>
          <p>
            <ArtistWikiLink artistName={track.channelTitle} videoId={track.id} className="artistInlineLink">
              {track.channelTitle}
            </ArtistWikiLink>
            {rowVariant !== "new" ? ` · ${track.favourited.toLocaleString()} favourites` : ""}
          </p>
        </div>
      </Link>
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
