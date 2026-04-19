"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";

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
let top100WarmWindowStartedAt = 0;
let top100WarmCountInWindow = 0;

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
  const hasWarmedRef = useRef(false);
  const clickFlashTimeoutRef = useRef<number | null>(null);
  const [isClickFlashing, setIsClickFlashing] = useState(false);

  useEffect(() => {
    return () => {
      if (clickFlashTimeoutRef.current !== null) {
        window.clearTimeout(clickFlashTimeoutRef.current);
        clickFlashTimeoutRef.current = null;
      }
    };
  }, []);

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

    hasWarmedRef.current = true;
    void fetch(`/api/current-video?v=${encodeURIComponent(track.id)}`, {
      cache: "no-store",
    }).catch(() => undefined);
  }, [stagePendingSelection, track.id, triggerClickFlash]);

  return (
    <article
      className={`trackCard leaderboardCard top100CardWithPlaylistAction${isSeen ? " top100CardSeen" : ""}${isSeen && rowVariant === "new" ? " top100CardSeenNew" : ""}${isClickFlashing ? " top100CardClickFlash" : ""}${isAuthenticated ? " top100CardCornerActions" : ""}${rowVariant === "new" ? " top100CardNewPersistentActions" : ""}`}
    >
      {isAuthenticated && onHideVideo ? (
        <button
          type="button"
          className="top100CardHideButton"
          aria-label={`Hide ${track.title} from Top 100`}
          title="Hide from Top 100"
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
        href={`/?v=${track.id}&resume=1`}
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
          {isSeen ? <span className="videoSeenBadge videoSeenBadgeOverlay">Seen</span> : null}
        </div>
        <div className="leaderboardMeta">
          <h3>{track.title}</h3>
          <p>
            <ArtistWikiLink artistName={track.channelTitle} videoId={track.id} className="artistInlineLink">
              {track.channelTitle}
            </ArtistWikiLink>
            {" "}· {track.favourited.toLocaleString()} favourites
          </p>
        </div>
      </Link>
      <div className="top100CardAction">
        <AddToPlaylistButton
          videoId={track.id}
          isAuthenticated={isAuthenticated}
          compact
          className="top100CardPlaylistAddButton"
        />
      </div>
    </article>
  );
}
