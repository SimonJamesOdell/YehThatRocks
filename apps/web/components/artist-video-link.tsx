"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import { SearchResultFavouriteButton } from "@/components/search-result-favourite-button";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";
import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";
import type { VideoRecord } from "@/lib/catalog";

const PENDING_VIDEO_SELECTION_KEY = "ytr:pending-video-selection";

type ArtistVideoLinkProps = {
  video: VideoRecord;
  isAuthenticated?: boolean;
  isSeen?: boolean;
  useCornerActions?: boolean;
  onHideVideo?: (video: VideoRecord) => void;
  isHidePending?: boolean;
};

export function ArtistVideoLink({
  video,
  isAuthenticated = true,
  isSeen = false,
  useCornerActions = false,
  onHideVideo,
  isHidePending = false,
}: ArtistVideoLinkProps) {
  const router = useRouter();
  const hasWarmedRef = useRef(false);
  const [isFavourited, setIsFavourited] = useState(Number(video.favourited ?? 0) > 0);
  const [isRemovingFavourite, setIsRemovingFavourite] = useState(false);
  const hasFavouriteHeart = isFavourited;

  useEffect(() => {
    setIsFavourited(Number(video.favourited ?? 0) > 0);
  }, [video.id, video.favourited]);

  const warmSelection = useCallback(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        PENDING_VIDEO_SELECTION_KEY,
        JSON.stringify({
          id: video.id,
          title: video.title,
          channelTitle: video.channelTitle,
          genre: video.genre,
          favourited: video.favourited,
          description: video.description,
        }),
      );
    }

    if (hasWarmedRef.current) {
      return;
    }

    hasWarmedRef.current = true;
    void fetch(`/api/current-video?v=${encodeURIComponent(video.id)}`, {
      cache: "no-store",
    }).catch(() => undefined);
  }, [video]);

  const openVideoFromCard = useCallback(() => {
    warmSelection();
    router.push(`/?v=${encodeURIComponent(video.id)}&resume=1`);
  }, [router, video.id, warmSelection]);

  const handleRemoveFavourite = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
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
        body: JSON.stringify({ videoId: video.id, action: "remove" }),
      });

      if (!response.ok) {
        return;
      }

      setIsFavourited(false);
      dispatchAppEvent(EVENT_NAMES.FAVOURITES_UPDATED, null);
    } finally {
      setIsRemovingFavourite(false);
    }
  }, [isAuthenticated, isRemovingFavourite, video.id]);

  return (
    <article
      className={`categoryVideoCard${isSeen ? " categoryVideoCardSeen artistVideoCardSeen" : ""}${useCornerActions ? " categoryVideoCardCornerActions" : ""}`}
      role="link"
      tabIndex={0}
      aria-label={`Play ${video.title}`}
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
      {isAuthenticated && useCornerActions && onHideVideo ? (
        <button
          type="button"
          className="categoryVideoHideButton"
          aria-label={`Hide ${video.title} from this category`}
          title="Hide from this category"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onHideVideo(video);
          }}
          disabled={isHidePending}
        >
          x
        </button>
      ) : null}
      <Link
        href={`/?v=${video.id}&resume=1`}
        className="linkedCard categoryVideoPrimaryLink"
        prefetch={false}
        onMouseEnter={warmSelection}
        onFocus={warmSelection}
        onPointerDown={warmSelection}
        onClick={warmSelection}
      >
        <div className="categoryThumbWrap">
          <YouTubeThumbnailImage
            videoId={video.id}
            alt=""
            className="categoryThumb"
            format="mqdefault"
            loading="lazy"
            decoding="async"
            hideClosestSelector=".categoryVideoCard"
            reportReason="thumbnail-load-error"
          />
          {isSeen && !hasFavouriteHeart ? <span className="videoSeenBadge videoSeenBadgeOverlay categorySeenBadgeOverlay">Seen</span> : null}
          {hasFavouriteHeart ? (
            <button
              type="button"
              className="relatedFavouriteBadgeOverlay artistVideoFavouriteBadgeOverlay artistVideoFavouriteBadgeButton"
              aria-label={`Remove ${video.title} from favourites`}
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
        <div className="relatedCardSourceBadges artistVideoSourceBadges">
          {video.isTop100Source ? <span className="relatedSourceBadge relatedSourceBadgeTop100">Top100</span> : null}
          {video.isNewSource ? <span className="relatedSourceBadge relatedSourceBadgeNew">New</span> : null}
        </div>
        <h3 className="categoryVideoTitle">{video.title}</h3>
      </Link>
      <div className="actionRow categoryVideoActions">
        {!isFavourited ? (
          <div
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <SearchResultFavouriteButton
              videoId={video.id}
              title={video.title}
              isAuthenticated={isAuthenticated}
              className={useCornerActions ? "categoryVideoFavouriteButton" : undefined}
              onSaved={() => setIsFavourited(true)}
            />
          </div>
        ) : null}
        <div
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <AddToPlaylistButton
            videoId={video.id}
            isAuthenticated={isAuthenticated}
            compact={useCornerActions}
            className={useCornerActions ? "categoryVideoPlaylistAddButton" : undefined}
          />
        </div>
      </div>
    </article>
  );
}