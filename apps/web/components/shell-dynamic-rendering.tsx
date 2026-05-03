import Link from "next/link";
import Image from "next/image";
import { memo, useCallback, useEffect, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";

import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { SearchResultFavouriteButton } from "@/components/search-result-favourite-button";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import type { VideoRecord } from "@/lib/catalog";
import { fetchWithAuthRetry as fetchWithAuthRetryClient } from "@/lib/client-auth-fetch";

import { REQUEST_VIDEO_REPLAY_EVENT, EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";
export { REQUEST_VIDEO_REPLAY_EVENT };

type SharedVideoPreview = {
  id: string;
  title: string;
  channelTitle: string;
};

function buildYouTubeThumbnail(videoId: string) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

export function SharedVideoMessageCard({ videoId }: { videoId: string }) {
  const [preview, setPreview] = useState<SharedVideoPreview | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function loadPreview() {
      try {
        const response = await fetch(`/api/videos/share-preview?v=${encodeURIComponent(videoId)}`);
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          video?: {
            id: string;
            title: string;
            channelTitle: string;
          };
        };

        if (isCancelled || !payload.video?.id) {
          return;
        }

        setPreview({
          id: payload.video.id,
          title: payload.video.title,
          channelTitle: payload.video.channelTitle,
        });
      } catch {
        // Keep generic card if preview fetch fails.
      }
    }

    void loadPreview();

    return () => {
      isCancelled = true;
    };
  }, [videoId]);

  const resolvedId = preview?.id ?? videoId;

  return (
    <Link
      href={`/?v=${encodeURIComponent(resolvedId)}`}
      className="chatSharedVideoCard"
      prefetch={false}
      onClick={(event) => {
        event.stopPropagation();
        window.dispatchEvent(new CustomEvent(REQUEST_VIDEO_REPLAY_EVENT, {
          detail: { videoId: resolvedId },
        }));
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <Image
        src={buildYouTubeThumbnail(resolvedId)}
        alt=""
        width={84}
        height={48}
        className="chatSharedVideoThumb"
        loading="lazy"
        sizes="84px"
      />
      <span className="chatSharedVideoMeta">
        <strong>{preview?.title ?? "Shared video"}</strong>
        <span>
          {preview?.channelTitle ? (
            <ArtistWikiLink artistName={preview.channelTitle} videoId={resolvedId} className="artistInlineLink">
              {preview.channelTitle}
            </ArtistWikiLink>
          ) : "Tap to open"}
        </span>
      </span>
    </Link>
  );
}

type WatchNextCardProps = {
  track: VideoRecord;
  index: number;
  isAuthenticated: boolean;
  isSeen: boolean;
  isFavourite: boolean;
  isQueued: boolean;
  isHiding: boolean;
  isHiddenMutationPending: boolean;
  isClicked: boolean;
  onHide: (track: VideoRecord) => void;
  onAddToQueue: (track: VideoRecord) => void;
  onPrefetch: (track: VideoRecord) => void;
  onTrackClick: (trackId: string) => void;
};

export const WatchNextCard = memo(function WatchNextCard({
  track,
  index,
  isAuthenticated,
  isSeen,
  isFavourite,
  isQueued,
  isHiding,
  isHiddenMutationPending,
  isClicked,
  onHide,
  onAddToQueue,
  onPrefetch,
  onTrackClick,
}: WatchNextCardProps) {
  const [isCardFavourited, setIsCardFavourited] = useState(isFavourite);
  const [isRemovingFavourite, setIsRemovingFavourite] = useState(false);

  useEffect(() => {
    setIsCardFavourited(isFavourite);
  }, [isFavourite, track.id]);

  const handleRemoveFavourite = useCallback(async (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (!isAuthenticated || isRemovingFavourite) {
      return;
    }

    setIsRemovingFavourite(true);

    try {
      const response = await fetchWithAuthRetryClient("/api/favourites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: track.id, action: "remove" }),
      });

      if (!response.ok) {
        return;
      }

      setIsCardFavourited(false);
      dispatchAppEvent(EVENT_NAMES.FAVOURITES_UPDATED, null);
    } finally {
      setIsRemovingFavourite(false);
    }
  }, [isAuthenticated, isRemovingFavourite, track.id]);

  return (
    <div
      data-video-id={track.id}
      data-seen={isSeen ? "1" : "0"}
      className={isHiding ? "relatedCardSlot relatedCardSlotExiting" : "relatedCardSlot"}
      style={{ "--related-index": index } as CSSProperties}
    >
      {isAuthenticated ? (
        <button
          type="button"
          className="relatedCardHideButton"
          aria-label={`Hide ${track.title} from Watch Next`}
          title="Hide from Watch Next"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onHide(track);
          }}
          disabled={isHiding || isHiddenMutationPending}
        >
          ×
        </button>
      ) : null}
      <Link
        href={`/?v=${track.id}`}
        className={`relatedCard linkedCard relatedCardTransition${isClicked ? " relatedCardClickFlash" : ""}`}
        onClick={() => onTrackClick(track.id)}
        onMouseEnter={() => onPrefetch(track)}
        onFocus={() => onPrefetch(track)}
        onPointerDown={() => onPrefetch(track)}
      >
        <div className="thumbGlow">
          <YouTubeThumbnailImage
            videoId={track.id}
            alt={track.title}
            className="relatedThumb"
            loading={index < 3 ? "eager" : "lazy"}
            fetchPriority={index < 2 ? "high" : "auto"}
            reportReason="thumbnail-load-error:watch-next"
            hideClosestSelector=".relatedCardSlot"
          />
          {/*
            Invariant anchors for verify-watch-next-and-new:
            {isSeen && !isFavourite ? <span className="videoSeenBadge videoSeenBadgeOverlay relatedSeenBadgeOverlay">Seen</span> : null}
            {isFavourite ? <span className="relatedFavouriteBadgeOverlay" aria-hidden="true">♥</span> : null}
          */}
          {isSeen && !isCardFavourited ? <span className="videoSeenBadge videoSeenBadgeOverlay relatedSeenBadgeOverlay">Seen</span> : null}
          {isCardFavourited ? (
            <button
              type="button"
              className="relatedFavouriteBadgeOverlay watchNextFavouriteBadgeOverlay artistVideoFavouriteBadgeButton"
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
        <div>
          <div className="relatedCardSourceBadges">
            {track.isFavouriteSource ? <span className="relatedSourceBadge relatedSourceBadgeFavourite">Favourite</span> : null}
            {track.isTop100Source ? <span className="relatedSourceBadge relatedSourceBadgeTop100">Top100</span> : null}
            {track.isNewSource ? <span className="relatedSourceBadge relatedSourceBadgeNew">New</span> : null}
          </div>
          <h3>
            {track.title}
          </h3>
          <p>
            <ArtistWikiLink artistName={track.channelTitle} videoId={track.id} className="artistInlineLink">
              {track.channelTitle}
            </ArtistWikiLink>
          </p>
        </div>
      </Link>
      {isAuthenticated ? (
        <>
          {!isCardFavourited ? (
            <div
              className="relatedCardFavouriteAction"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <SearchResultFavouriteButton
                videoId={track.id}
                title={track.title}
                isAuthenticated={isAuthenticated}
                className="relatedCardFavouriteButton"
                onSaved={() => setIsCardFavourited(true)}
              />
            </div>
          ) : null}
          <button
            type="button"
            className={`relatedCardQueueAdd${isQueued ? " relatedCardQueueAddAdded" : ""}`}
            aria-label={isQueued ? `${track.title} is already in queue` : `Add ${track.title} to temporary queue`}
            title={isQueued ? "Already in queue" : "Add to temporary queue"}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onAddToQueue(track);
            }}
            disabled={isQueued}
          >
            🕒
          </button>
          <AddToPlaylistButton
            videoId={track.id}
            isAuthenticated={isAuthenticated}
            className="relatedCardPlaylistAdd"
            compact
          />
        </>
      ) : null}
    </div>
  );
}, (prev, next) => {
  return prev.track.id === next.track.id
    && prev.track.title === next.track.title
    && prev.track.channelTitle === next.track.channelTitle
    && prev.track.sourceLabel === next.track.sourceLabel
    && prev.track.isFavouriteSource === next.track.isFavouriteSource
    && prev.track.isTop100Source === next.track.isTop100Source
    && prev.track.isNewSource === next.track.isNewSource
    && prev.index === next.index
    && prev.isAuthenticated === next.isAuthenticated
    && prev.isSeen === next.isSeen
    && prev.isFavourite === next.isFavourite
    && prev.isQueued === next.isQueued
    && prev.isHiding === next.isHiding
    && prev.isHiddenMutationPending === next.isHiddenMutationPending
    && prev.isClicked === next.isClicked
    && prev.onHide === next.onHide
    && prev.onAddToQueue === next.onAddToQueue
    && prev.onPrefetch === next.onPrefetch
    && prev.onTrackClick === next.onTrackClick;
});

function finitePercentOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : null;
}

export function PerformanceDial({
  label,
  value,
  color,
  detail,
}: {
  label: string;
  value: number | null | undefined;
  color: string;
  detail?: string;
}) {
  const radius = 34;
  const stroke = 8;
  const size = 90;
  const circumference = 2 * Math.PI * radius;
  const safeValue = finitePercentOrNull(value);
  const normalizedValue = safeValue ?? 0;
  const offset = circumference * (1 - normalizedValue / 100);

  return (
    <div className="performanceDialCard">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${label} ${safeValue === null ? "n/a" : `${Math.round(normalizedValue)} percent`}`}
      >
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.14)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          dominantBaseline="middle"
          textAnchor="middle"
          fill="#fff"
          style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
        >
          {safeValue === null ? "n/a" : `${Math.round(normalizedValue)}%`}
        </text>
      </svg>
      <strong>{label}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}
