import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useState, type CSSProperties, type ReactNode, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { fetchArtistVideoCountBatched } from "@/components/artist-count-batcher";

import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { PlaylistSummaryCardContent } from "@/components/playlist-summary-card-content";
import { QueueTrackCardContent } from "@/components/queue-track-card-content";
import { RightRailLoadingState } from "@/components/right-rail-loading-state";
import { RightRailPlaylistEmptyState } from "@/components/right-rail-playlist-empty-state";
import { SearchResultFavouriteButton } from "@/components/search-result-favourite-button";
import { VideoGenreLink } from "@/components/video-genre-link";
import { finitePercentOrNull } from "@/components/shell-dynamic-utils";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import type { VideoRecord } from "@/lib/catalog";
import { fetchWithAuthRetry as fetchWithAuthRetryClient } from "@/lib/client-auth-fetch";
import { inferArtistFromTitle } from "@/lib/catalog-metadata-utils";
import { getArtistPagePath } from "@/lib/artist-routing";
import { CHAT_OPENED_VIDEO_ACTIVITY_SUPPRESS_KEY } from "@/lib/storage-keys";
import type { PlaylistRailSummary } from "@/components/use-playlist-rail";
import type { ShellMagazineTrack } from "@/components/use-shell-admin-state";
import { MagazineGenerateNowButton } from "@/components/magazine-generate-now-button";
import { resolveVideoGenreNavigationTarget } from "@/lib/video-genre-navigation";

import { REQUEST_VIDEO_REPLAY_EVENT, EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";
export { REQUEST_VIDEO_REPLAY_EVENT };

function inferTrackForWatchNext(title: string, artist: string): string {
  const trimmedTitle = title.trim();
  const trimmedArtist = artist.trim();
  if (!trimmedTitle || !trimmedArtist) return trimmedTitle;
  const separators = [" - ", " — ", " | "];
  for (const separator of separators) {
    const split = trimmedTitle.split(separator).map((part) => part.trim()).filter(Boolean);
    if (split.length < 2) continue;
    const [left, right] = split;
    if (left.toLowerCase() === trimmedArtist.toLowerCase()) return right;
    if (right.toLowerCase() === trimmedArtist.toLowerCase()) return left;
  }
  return trimmedTitle;
}

const GENERIC_WATCH_NEXT_ARTIST_LABELS = new Set(["unknown artist", "unknown", "youtube"]);
const sharedVideoPreviewCache = new Map<string, SharedVideoPreview | null>();
const sharedVideoPreviewInFlight = new Map<string, Promise<SharedVideoPreview | null>>();

type SharedVideoPreview = {
  id: string;
  title: string;
  channelTitle: string;
  genre: string | null;
  parsedArtist: string | null;
  parsedTrack: string | null;
};

function buildYouTubeThumbnail(videoId: string) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

async function fetchSharedVideoPreview(videoId: string): Promise<SharedVideoPreview | null> {
  if (sharedVideoPreviewCache.has(videoId)) {
    return sharedVideoPreviewCache.get(videoId) ?? null;
  }

  const inFlight = sharedVideoPreviewInFlight.get(videoId);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(`/api/videos/share-preview?v=${encodeURIComponent(videoId)}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          if (response.status === 404 || response.status === 400) {
            break;
          }

          continue;
        }

        const payload = (await response.json()) as {
          video?: {
            id: string;
            title: string;
            channelTitle: string;
            genre?: string | null;
            parsedArtist?: string | null;
            parsedTrack?: string | null;
          };
        };

        if (!payload.video?.id) {
          continue;
        }

        const resolved: SharedVideoPreview = {
          id: payload.video.id,
          title: payload.video.title,
          channelTitle: payload.video.channelTitle,
          genre: payload.video.genre ?? null,
          parsedArtist: payload.video.parsedArtist ?? null,
          parsedTrack: payload.video.parsedTrack ?? null,
        };

        sharedVideoPreviewCache.set(videoId, resolved);
        return resolved;
      } catch {
        // Retry transient failures.
      }
    }

    sharedVideoPreviewCache.set(videoId, null);
    return null;
  })().finally(() => {
    sharedVideoPreviewInFlight.delete(videoId);
  });

  sharedVideoPreviewInFlight.set(videoId, request);
  return request;
}

export function SharedVideoMessageCard({
  videoId,
  fallbackTitle,
  fallbackChannelTitle,
  rightActions,
  onShare,
  onDismiss,
  shareState,
}: {
  videoId: string;
  fallbackTitle?: string;
  fallbackChannelTitle?: string;
  rightActions?: ReactNode;
  onShare?: () => void;
  onDismiss?: () => void;
  shareState?: "idle" | "sending" | "sent" | "error" | "hidden";
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<SharedVideoPreview | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function loadPreview() {
      const resolvedPreview = await fetchSharedVideoPreview(videoId);
      if (isCancelled || !resolvedPreview) {
        return;
      }

      setPreview(resolvedPreview);
    }

    void loadPreview();

    return () => {
      isCancelled = true;
    };
  }, [videoId]);

  const resolvedId = preview?.id ?? videoId;
  const fallbackChannel = fallbackChannelTitle?.trim() || null;
  const resolvedTitle = preview?.title?.trim() || fallbackTitle?.trim() || null;
  const previewParsedArtist = preview?.parsedArtist?.trim() || null;
  const previewChannelTitle = preview?.channelTitle?.trim() || null;
  const parsedArtist = previewParsedArtist || previewChannelTitle || fallbackChannel || null;
  const parsedArtistPagePath = parsedArtist ? getArtistPagePath(parsedArtist) : null;
  const genreLabel = preview?.genre?.trim() || null;
  const parsedTrack = preview?.parsedTrack?.trim() || null;
  const parsedArtistLabel = parsedArtist?.toUpperCase() ?? null;
  const resolvedArtistNameForWiki = preview?.channelTitle?.trim() || parsedArtist || fallbackChannel || "Unknown Artist";
  const resolvedTrack = parsedTrack
    || (resolvedTitle ? inferTrackForWatchNext(resolvedTitle, parsedArtist ?? "") : null)
    || resolvedTitle
    || null;

  const handleOpenArtistPage = useCallback((event: ReactMouseEvent<HTMLSpanElement>) => {
    if (!parsedArtistPagePath) return;
    event.preventDefault();
    event.stopPropagation();
    router.push(parsedArtistPagePath);
  }, [parsedArtistPagePath, router]);

  const handleOpenArtistPageByKeyboard = useCallback((event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (!parsedArtistPagePath) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    router.push(parsedArtistPagePath);
  }, [parsedArtistPagePath, router]);

  const cardInner = (
    <>
      <div className="thumbGlow">
        <Image
          src={buildYouTubeThumbnail(resolvedId)}
          alt=""
          width={102}
          height={58}
          className="relatedThumb chatSharedVideoThumb"
          loading="lazy"
          sizes="102px"
        />
      </div>
      <div className="chatSharedVideoMeta">
        {genreLabel ? (
          <p className="relatedCardGenre chatSharedVideoGenre" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            <VideoGenreLink genre={genreLabel} stopPropagation nestedInLink />
          </p>
        ) : null}
        <h3>
          {parsedArtistLabel && resolvedTrack ? (
            <>
              <ArtistWikiLink artistName={resolvedArtistNameForWiki} videoId={resolvedId} className="artistInlineLink">
                <span
                  role={parsedArtistPagePath ? "link" : undefined}
                  tabIndex={parsedArtistPagePath ? 0 : undefined}
                  onClick={handleOpenArtistPage}
                  onKeyDown={handleOpenArtistPageByKeyboard}
                >
                  {parsedArtistLabel}
                </span>
              </ArtistWikiLink>
              <span aria-hidden="true"> - </span>
              <span>{resolvedTrack}</span>
            </>
          ) : parsedArtistLabel ? (
            <ArtistWikiLink artistName={resolvedArtistNameForWiki} videoId={resolvedId} className="artistInlineLink">
              <span
                role={parsedArtistPagePath ? "link" : undefined}
                tabIndex={parsedArtistPagePath ? 0 : undefined}
                onClick={handleOpenArtistPage}
                onKeyDown={handleOpenArtistPageByKeyboard}
              >
                {parsedArtistLabel}
              </span>
            </ArtistWikiLink>
          ) : (
            <span>{resolvedTrack || "Shared video"}</span>
          )}
        </h3>
      </div>
    </>
  );

  const hasActions = onShare || onDismiss || rightActions;

  return (
    <div className={`relatedCardSlot chatSharedVideoCardSlot${hasActions ? " chatSharedVideoCardSlotActions" : ""}`}>
      <Link
        href={`/?v=${encodeURIComponent(resolvedId)}`}
        className={`relatedCard linkedCard chatSharedVideoCard${hasActions ? " chatSharedVideoCardWithActions" : ""}`}
        prefetch={false}
        onClick={(event) => {
          event.stopPropagation();

          const isPrimaryButton = event.button === 0 || event.button === undefined;
          if (isPrimaryButton && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
            window.sessionStorage.setItem(CHAT_OPENED_VIDEO_ACTIVITY_SUPPRESS_KEY, resolvedId);
          }

          window.dispatchEvent(new CustomEvent(REQUEST_VIDEO_REPLAY_EVENT, {
            detail: { videoId: resolvedId },
          }));
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {cardInner}
      </Link>
      {onDismiss ? (
        <button
          type="button"
          className="chatSharedVideoCardDismiss"
          aria-label="Dismiss"
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          ×
        </button>
      ) : null}
      {onShare ? (
        <button
          type="button"
          className={`chatSharedVideoCardShareBtn${shareState === "sending" ? " chatSharedVideoCardShareBtnSending" : ""}${shareState === "sent" ? " chatSharedVideoCardShareBtnSent" : ""}${shareState === "error" ? " chatSharedVideoCardShareBtnError" : ""}`}
          aria-label={shareState === "sent" ? "Shared" : shareState === "error" ? "Share failed — retry" : "Share to chat"}
          title={shareState === "sent" ? "Shared" : shareState === "error" ? "Share failed — retry" : "Share to chat"}
          disabled={shareState === "sending"}
          onClick={(e) => { e.stopPropagation(); onShare(); }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {shareState === "sent" ? "✓" : shareState === "error" ? "!" : "↑"}
        </button>
      ) : null}
      {rightActions ? (
        <div className="chatSharedVideoCardActions" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          {rightActions}
        </div>
      ) : null}
    </div>
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
  const router = useRouter();
  const [isCardFavourited, setIsCardFavourited] = useState(isFavourite);
  const [isRemovingFavourite, setIsRemovingFavourite] = useState(false);
  const [artistVideoCount, setArtistVideoCount] = useState<number | null>(null);

  const rawDisplayTitle = track.title;
  const channelArtistCandidate = track.channelTitle?.trim() || "";
  const safeChannelArtistCandidate = GENERIC_WATCH_NEXT_ARTIST_LABELS.has(channelArtistCandidate.toLowerCase())
    ? ""
    : channelArtistCandidate;
  const parsedArtistCandidate =
    track.parsedArtist?.trim()
    || safeChannelArtistCandidate
    || inferArtistFromTitle(rawDisplayTitle)?.trim()
    || "";
  const metadataArtist = parsedArtistCandidate || "Unknown Artist";
  const parsedTrackCandidate =
    track.parsedTrack?.trim()
    || inferTrackForWatchNext(rawDisplayTitle, metadataArtist)
    || "";
  const parsedArtistLabel = parsedArtistCandidate.toUpperCase();
  const parsedArtistPagePath = parsedArtistCandidate ? getArtistPagePath(parsedArtistCandidate) : null;
  const artistSlug = parsedArtistPagePath?.split("/")[2] ?? null;
  const artistVideoCountLabel = artistVideoCount === null
    ? null
    : `${artistVideoCount.toLocaleString("en-US")} videos`;
  const genreLabel = track.genre?.trim() || "Rock / Metal";

  useEffect(() => {
    setIsCardFavourited(isFavourite);
  }, [isFavourite, track.id]);

  useEffect(() => {
    if (!artistSlug) {
      setArtistVideoCount(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const count = await fetchArtistVideoCountBatched(artistSlug, track.id);
      if (!cancelled) setArtistVideoCount(count);
    })();
    return () => { cancelled = true; };
  }, [artistSlug, track.id]);

  const handleOpenParsedArtistPage = useCallback((event: ReactMouseEvent<HTMLSpanElement>) => {
    if (!parsedArtistPagePath) return;
    event.preventDefault();
    event.stopPropagation();
    router.push(parsedArtistPagePath);
  }, [parsedArtistPagePath, router]);

  const handleOpenParsedArtistPageByKeyboard = useCallback((event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (!parsedArtistPagePath) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    router.push(parsedArtistPagePath);
  }, [parsedArtistPagePath, router]);

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
          <p className="relatedCardGenre"><VideoGenreLink genre={genreLabel} stopPropagation nestedInLink /></p>
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
            ) : track.title}
          </h3>
          {artistVideoCountLabel ? (
            <p className="leaderboardArtistVideoCount">{artistVideoCountLabel}</p>
          ) : null}
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
    && prev.track.genre === next.track.genre
    && prev.track.parsedArtist === next.track.parsedArtist
    && prev.track.parsedTrack === next.track.parsedTrack
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

// ── Queue panel (extracted from shell-dynamic-core) ────────────────────────────

type QueuePanelProps = {
  tracks: VideoRecord[];
  activeVideoId: string;
  clickedRelatedVideoId: string | null;
  onTrackClick: (videoId: string) => void;
  onPrefetch: (track: VideoRecord) => void;
  onRemove: (videoId: string) => void;
  onClear: () => void;
};

export function QueuePanel({
  tracks,
  activeVideoId,
  clickedRelatedVideoId,
  onTrackClick,
  onPrefetch,
  onRemove,
  onClear,
}: QueuePanelProps) {
  return (
    <div className="relatedStack relatedStackPlaylist">
      <div className="rightRailPlaylistBar">
        <span className="rightRailPlaylistLabel">
          Current queue • {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
        </span>
        {tracks.length > 0 ? (
          <div className="rightRailPlaylistActions">
            <button
              type="button"
              className="rightRailPlaylistClose"
              onClick={onClear}
            >
              Clear
            </button>
          </div>
        ) : null}
      </div>
      <div className="relatedStackPlaylistBody">
        {tracks.length > 0 ? (
          tracks.map((track, index) => (
            <div
              key={`${track.id}:${index}`}
              className="relatedCardSlot"
              style={{ "--related-index": index } as CSSProperties}
            >
              <button
                type="button"
                className="relatedCardHideButton"
                aria-label={`Remove ${track.title} from temporary queue`}
                title="Remove from temporary queue"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onRemove(track.id);
                }}
              >
                ×
              </button>
              <Link
                href={`/?v=${track.id}`}
                className={`relatedCard linkedCard relatedCardTransition rightRailPlaylistTrackCard${track.id === activeVideoId ? " relatedCardActive" : ""}${clickedRelatedVideoId === track.id ? " relatedCardClickFlash" : ""}`}
                onClick={() => onTrackClick(track.id)}
                onMouseEnter={() => onPrefetch(track)}
                onFocus={() => onPrefetch(track)}
                onPointerDown={() => onPrefetch(track)}
              >
                <QueueTrackCardContent track={track} index={index} />
              </Link>
            </div>
          ))
        ) : (
          <p className="rightRailStatus">Queue is empty.</p>
        )}
      </div>
    </div>
  );
}

// ── Playlist index panel (extracted from shell-dynamic-core) ───────────────────

type PlaylistIndexPanelProps = {
  isLoading: boolean;
  error: string | null;
  summaries: PlaylistRailSummary[];
  isCreating: boolean;
  deletingPlaylistId: string | null;
  onDeletePlaylist: (playlist: { id: string; name: string }) => void;
  getActivatePlaylistHref: (playlistId: string) => string;
  onCreate: () => void;
};

export function PlaylistIndexPanel({
  isLoading,
  error,
  summaries,
  isCreating,
  deletingPlaylistId,
  onDeletePlaylist,
  getActivatePlaylistHref,
  onCreate,
}: PlaylistIndexPanelProps) {
  if (isLoading) {
    return <RightRailLoadingState message="Loading playlists..." />;
  }

  if (error) {
    return <p className="rightRailStatus">{error}</p>;
  }

  if (summaries.length === 0) {
    return (
      <RightRailPlaylistEmptyState
        isCreating={isCreating}
        onCreate={onCreate}
      />
    );
  }

  return (
    <>
      {summaries.map((playlist) => {
        const hasLeadThumbnail = playlist.itemCount > 0 && playlist.leadVideoId !== "__placeholder__";
        const isDeleting = deletingPlaylistId === playlist.id;
        return (
          <Link
            key={playlist.id}
            href={getActivatePlaylistHref(playlist.id)}
            className="relatedCard linkedCard rightRailPlaylistCard"
            data-video-id={hasLeadThumbnail ? playlist.leadVideoId : undefined}
            prefetch={false}
          >
            <button
              type="button"
              className="rightRailPlaylistCardDelete"
              aria-label={`Delete ${playlist.name}`}
              title="Delete playlist"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDeletePlaylist({ id: playlist.id, name: playlist.name });
              }}
              disabled={deletingPlaylistId !== null}
            >
              {isDeleting ? "…" : "🗑"}
            </button>
            <PlaylistSummaryCardContent
              playlist={playlist}
              hasLeadThumbnail={hasLeadThumbnail}
            />
            </Link>
        );
      })}
    </>
  );
}

// ── Magazine rail content (extracted from shell-dynamic-core) ──────────────────

type MagazineRailContentProps = {
  isLoading: boolean;
  tracks: ShellMagazineTrack[];
  isAdmin: boolean;
  deletingSlugs: Record<string, boolean>;
  deleteErrors: Record<string, string>;
  onDeleteArticle: (track: ShellMagazineTrack) => Promise<void>;
  onNavigateToArticle: (slug: string) => void;
  onNavigateToGenre: (genre: string) => void;
};

export function MagazineRailContent({
  isLoading,
  tracks,
  isAdmin,
  deletingSlugs,
  deleteErrors,
  onDeleteArticle,
  onNavigateToArticle,
  onNavigateToGenre,
}: MagazineRailContentProps) {
  if (isLoading) {
    return <RightRailLoadingState message="Loading articles..." />;
  }

  if (tracks.length === 0) {
    return <p className="chatStatus">No magazine articles are available yet.</p>;
  }

  return (
    <>
      <div className="magazineRailHeader">
        <strong>Latest Articles</strong>
        {isAdmin ? <MagazineGenerateNowButton /> : null}
      </div>
      {tracks.map((track) => (
        <article
          key={track.slug}
          className="magazineRailCard magazineRailCardClickable"
          onClick={() => {
            window.scrollTo(0, 0);
            onNavigateToArticle(track.slug);
          }}
          role="button"
          tabIndex={0}
          aria-label={`Open magazine article: ${track.artist} - ${track.title}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`}
            alt={`${track.artist} - ${track.title} thumbnail`}
            width={168}
            height={96}
            className="magazineRailThumb"
            loading="lazy"
          />
          {isAdmin ? (
            <button
              type="button"
              className="magazineAdminDeleteButton"
              aria-label={`Delete article: ${track.title}`}
              disabled={Boolean(deletingSlugs[track.slug])}
              onClick={async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await onDeleteArticle(track);
              }}
            >
              {deletingSlugs[track.slug] ? "…" : "✕"}
            </button>
          ) : null}
          <div className="magazineRailBody">
            <div className="messageMeta">
              <strong>{track.artist}</strong>
              {track.kicker ? (
                <span>{track.kicker}</span>
              ) : (
                <span
                  role="link"
                  tabIndex={0}
                  style={{ cursor: "pointer", textDecoration: "underline" }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onNavigateToGenre(track.genre);
                  }}
                >
                  {track.genre}
                </span>
              )}
            </div>
            <p>{track.title}</p>
            {deleteErrors[track.slug] ? (
              <p className="magazineRailAdminDeleteError">{deleteErrors[track.slug]}</p>
            ) : null}
          </div>
        </article>
      ))}
    </>
  );
}