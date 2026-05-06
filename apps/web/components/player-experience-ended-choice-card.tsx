"use client";

import { memo, useCallback, useEffect, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";

import type { VideoRecord } from "@/lib/catalog";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import { SearchResultFavouriteButton } from "@/components/search-result-favourite-button";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";
import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";

type EndedChoiceCardProps = {
  video: VideoRecord;
  index: number;
  isSeen: boolean;
  isHiding: boolean;
  shouldAnimateCard: boolean;
  isLoggedIn: boolean;
  onSelect: (videoId: string) => void;
  onHide: (video: VideoRecord) => void;
  onMeasure?: (node: HTMLDivElement | null) => void;
};

export const EndedChoiceCard = memo(function EndedChoiceCard({
  video,
  index,
  isSeen,
  isHiding,
  shouldAnimateCard,
  isLoggedIn,
  onSelect,
  onHide,
  onMeasure,
}: EndedChoiceCardProps) {
  const [isFavourited, setIsFavourited] = useState(Number(video.favourited ?? 0) > 0);
  const [isRemovingFavourite, setIsRemovingFavourite] = useState(false);

  useEffect(() => {
    setIsFavourited(Number(video.favourited ?? 0) > 0);
  }, [video.id, video.favourited]);

  const cardClassName = isHiding
    ? "endedChoiceCardSlot endedChoiceCardSlotExiting"
    : shouldAnimateCard
      ? "endedChoiceCardSlot"
      : "endedChoiceCardSlot endedChoiceCardSlotStatic";

  const cardStyle = shouldAnimateCard
    ? {
        "--ended-choice-row-4": Math.min(3, Math.floor(index / 4)),
        "--ended-choice-row-2": Math.min(5, Math.floor(index / 2)),
        "--ended-choice-row-1": Math.min(7, index),
      } as CSSProperties
    : undefined;

  const handleHide = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onHide(video);
  }, [onHide, video]);

  const handleSelect = useCallback(() => {
    onSelect(video.id);
  }, [onSelect, video.id]);

  const handleRemoveFavourite = useCallback(async (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (!isLoggedIn || isRemovingFavourite) {
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
  }, [isLoggedIn, isRemovingFavourite, video.id]);

  return (
    <div
      ref={onMeasure}
      className={cardClassName}
      style={cardStyle}
    >
      {isLoggedIn ? (
        <button
          type="button"
          className="endedChoiceCardHideBtn"
          aria-label={`Hide ${video.title} from suggestions`}
          title="Hide from suggestions"
          onClick={handleHide}
          disabled={isHiding}
        >x</button>
      ) : null}
      <div
        role="button"
        tabIndex={0}
        className={isSeen ? "playerEndedChoiceCard playerEndedChoiceCardSeen" : "playerEndedChoiceCard"}
        onClick={handleSelect}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }

          event.preventDefault();
          handleSelect();
        }}
      >
        <div className="playerEndedChoiceThumbWrap">
          <YouTubeThumbnailImage
            videoId={video.id}
            alt=""
            className="playerEndedChoiceThumb"
            format="mqdefault"
            loading="lazy"
            hideClosestSelector=".endedChoiceCardSlot"
            reportReason="thumbnail-load-error:ended-choice"
          />
          {isSeen && !isFavourited ? <span className="playerEndedChoiceSeenBadge">Seen</span> : null}
          {isFavourited ? (
            <button
              type="button"
              className="relatedFavouriteBadgeOverlay endedChoiceFavouriteBadgeOverlay artistVideoFavouriteBadgeButton"
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
        <span className="playerEndedChoiceMeta">
          <span className="playerEndedChoiceTitle">
            {video.title}
          </span>
          <span className="playerEndedChoiceChannel">
            <ArtistWikiLink artistName={video.channelTitle} videoId={video.id} className="artistInlineLink">
              {video.channelTitle}
            </ArtistWikiLink>
          </span>
        </span>
      </div>
      {isLoggedIn ? (
        <div className="endedChoiceCardActions">
          {!isFavourited ? (
            <SearchResultFavouriteButton
              videoId={video.id}
              title={video.title}
              isAuthenticated={isLoggedIn}
              className="endedChoiceCardFavouriteBtn"
              onSaved={() => setIsFavourited(true)}
            />
          ) : null}
          <AddToPlaylistButton
            videoId={video.id}
            isAuthenticated={isLoggedIn}
            className="endedChoiceCardPlaylistBtn"
            compact
          />
        </div>
      ) : null}
    </div>
  );
}, (prev, next) => {
  return prev.video.id === next.video.id
    && prev.video.title === next.video.title
    && prev.video.channelTitle === next.video.channelTitle
    && prev.index === next.index
    && prev.isSeen === next.isSeen
    && prev.isHiding === next.isHiding
    && prev.shouldAnimateCard === next.shouldAnimateCard
    && prev.isLoggedIn === next.isLoggedIn
    && prev.onSelect === next.onSelect
    && prev.onHide === next.onHide
    && prev.onMeasure === next.onMeasure;
});
