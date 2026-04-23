"use client";

import { ChangeEvent, memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type MouseEvent as ReactMouseEvent, type UIEvent } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { VideoRecord } from "@/lib/catalog";
import { buildSharedVideoMessage } from "@/lib/chat-shared-video";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { buildCanonicalShareUrl } from "@/lib/share-metadata";
import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";
import { useSeenTogglePreference } from "@/components/use-seen-toggle-preference";

type PlayerExperienceProps = {
  currentVideo: VideoRecord;
  queue: VideoRecord[];
  isLoggedIn: boolean;
  isAdmin?: boolean;
  isDockedDesktop?: boolean;
  seenVideoIds?: Set<string>;
  onHideVideo?: (track: VideoRecord) => void | Promise<void>;
  onAddVideoToPlaylist?: (track: VideoRecord) => void | Promise<void>;
  onDockHideRequest?: () => void;
  forcedUnavailableSignal?: number;
  forcedUnavailableMessage?: string | null;
  isRouteResolving?: boolean;
  routeLoadingLabel?: string;
  routeLoadingMessage?: string;
};

type AdminEditableVideo = {
  id: number;
  videoId: string;
  title: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
  parsedVideoType: string | null;
  parseConfidence: number | null;
  channelTitle: string | null;
  description: string | null;
  updatedAt: string | Date | null;
};

type PlaylistPayload = {
  id: string;
  videos: VideoRecord[];
};

type PlaylistSummary = {
  id: string;
  name: string;
  itemCount?: number;
};

type PlayerPreferencesResponse = {
  autoplayEnabled?: boolean | null;
  volume?: number | null;
};

type LyricsAvailabilityResponse = {
  available?: boolean;
};

type NextChoiceVideo = VideoRecord;

type YouTubePlayerStateChangeEvent = {
  data: number;
};

type YouTubePlayerErrorEvent = {
  data: number;
};

type YouTubePlayerReadyEvent = {
  target: YouTubePlayer;
};

type YouTubePlayer = {
  destroy: () => void;
  cueVideoById?: (videoId: string) => void;
  cueVideoByUrl?: (url: string) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  getVolume: () => number;
  isMuted: () => boolean;
  loadVideoById: (videoId: string) => void;
  loadVideoByUrl?: (url: string) => void;
  mute: () => void;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
  unMute: () => void;
};

type YouTubeNamespace = {
  Player: new (
    element: HTMLDivElement,
    config: {
      videoId: string;
      host?: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (event: YouTubePlayerReadyEvent) => void;
        onStateChange?: (event: YouTubePlayerStateChangeEvent) => void;
        onError?: (event: YouTubePlayerErrorEvent) => void;
      };
    }
  ) => YouTubePlayer;
  PlayerState: {
    ENDED: number;
    PAUSED: number;
    PLAYING: number;
  };
};

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
    __ytrInitialPageLoadAutoplaySuppressed?: boolean;
    __ytrInitialPageLoadVideoId?: string | null;
  }
}

const AUTOPLAY_KEY = "yeh-player-autoplay";
const PLAYER_VOLUME_KEY = "yeh-player-volume";
const PLAYER_MUTED_KEY = "yeh-player-muted";
const HISTORY_KEY = "yeh-player-history";
const RESUME_KEY = "yeh-player-resume";
const HISTORY_LIMIT = 20;
const AUTOPLAY_FALLBACK_POOL_SIZE = 600;
const NEW_AUTOPLAY_PLAYLIST_SIZE = 50;
const RANDOM_NEXT_RECENT_EXCLUSION = 18;
const UNAVAILABLE_PLAYER_CODES = new Set([5, 100, 101, 150]);
const PLAYER_DEBUG_ENABLED = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEBUG_PLAYER === "1";
const WATCH_HISTORY_UPDATED_EVENT = "ytr:watch-history-updated";
const FLOW_DEBUG_ENABLED = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEBUG_FLOW === "1";
const UNAVAILABLE_OVERLAY_MESSAGE = "Sorry, this video is no longer available. Please choose another track.";
const UPSTREAM_CONNECTIVITY_OVERLAY_MESSAGE = "We could not connect to the upstream video provider for this track. This is not a YehThatRocks failure. Please try the refresh button and if that does not work, choose another track.";
const STUCK_PLAYBACK_CHECK_MS = 5000;
const STUCK_PLAYBACK_MAX_RETRIES = 3;
const STUCK_PLAYBACK_RETRY_DELAYS_MS = [600, 1400, 2600] as const;
const MID_PLAYBACK_BUFFERING_CHECK_MS = 1000;
const MID_PLAYBACK_BUFFERING_THRESHOLD_MS = 8000;
const PLAYER_LOAD_REFRESH_HINT_DELAY_MS = 2000;
const PLAYER_AUTO_RECONNECT_DELAY_MS = 2000;
const MANUAL_TRANSITION_MASK_TIMEOUT_MS = 8000;
const PLAYLISTS_UPDATED_EVENT = "ytr:playlists-updated";
const LAST_PLAYLIST_ID_KEY = "ytr:last-playlist-id";
const RIGHT_RAIL_MODE_EVENT = "ytr:right-rail-mode";
const RIGHT_RAIL_LYRICS_OPEN_EVENT = "ytr:right-rail-lyrics-open";
const REQUEST_VIDEO_REPLAY_EVENT = "ytr:request-video-replay";
const ADMIN_OVERLAY_ENTER_EVENT = "ytr:admin-overlay-enter";
const maxEndedChoiceVideos = 12;
const ENDED_CHOICE_SET_SIZE = maxEndedChoiceVideos;
const ENDED_CHOICE_INITIAL_PREFETCH_SETS = 2;
const ENDED_CHOICE_SCROLL_PREFETCH_BUFFER_SETS = 3;
const ENDED_CHOICE_PREFETCH_BEFORE_END_SECONDS = 8;
const ENDED_CHOICE_HIDE_SEEN_TOGGLE_KEY = "ytr-toggle-hide-seen-ended-choice";

if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  const consoleWithPatchState = console as typeof console & {
    __ytrWarnPatched?: boolean;
  };

  if (!consoleWithPatchState.__ytrWarnPatched) {
    const originalWarn = console.warn.bind(console);
    consoleWithPatchState.__ytrWarnPatched = true;

    console.warn = (...args: unknown[]) => {
      const first = args[0];
      const message = typeof first === "string" ? first : "";

      // YouTube widget emits this repeatedly in some browsers; hide this known non-actionable warning.
      if (message.includes("Unrecognized feature: 'web-share'.")) {
        return;
      }

      originalWarn(...args);
    };
  }
}

function logPlayerDebug(event: string, detail?: Record<string, unknown>) {
  if (!PLAYER_DEBUG_ENABLED) {
    return;
  }

  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[player] ${event}${payload}`);
}

function logFlow(event: string, detail?: Record<string, unknown>) {
  if (!FLOW_DEBUG_ENABLED) {
    return;
  }

  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[flow/player] ${event}${payload}`);
}

function toSafeNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizePlayerVolume(value: unknown, fallback = 100) {
  return Math.max(0, Math.min(100, Math.round(toSafeNumber(value, fallback))));
}

function formatPlaybackTime(value: number) {
  const safeValue = Math.max(0, Math.floor(toSafeNumber(value, 0)));
  const hours = Math.floor(safeValue / 3600);
  const minutes = Math.floor((safeValue % 3600) / 60);
  const seconds = safeValue % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function buildGeneratedPlaylistName() {
  const now = new Date();
  const datePart = now.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const timePart = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Playlist ${datePart} ${timePart}`;
}

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

const EndedChoiceCard = memo(function EndedChoiceCard({
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
        >×</button>
      ) : null}
      <button
        type="button"
        className={isSeen ? "playerEndedChoiceCard playerEndedChoiceCardSeen" : "playerEndedChoiceCard"}
        onClick={handleSelect}
      >
        <div className="playerEndedChoiceThumbWrap">
          <img
            src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`}
            alt=""
            className="playerEndedChoiceThumb"
            loading="lazy"
          />
          {isSeen ? <span className="playerEndedChoiceSeenBadge">Seen</span> : null}
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
      </button>
      {isLoggedIn ? (
        <AddToPlaylistButton
          videoId={video.id}
          isAuthenticated={isLoggedIn}
          className="endedChoiceCardPlaylistBtn"
          compact
        />
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

function switchPlayerVideo(player: YouTubePlayer, videoId: string) {
  const playerWithFallbacks = player as YouTubePlayer & {
    cueVideoById?: (id: string) => void;
    loadVideoByUrl?: (url: string) => void;
    cueVideoByUrl?: (url: string) => void;
  };

  if (typeof playerWithFallbacks.loadVideoById === "function") {
    playerWithFallbacks.loadVideoById(videoId);
    return true;
  }

  if (typeof playerWithFallbacks.cueVideoById === "function") {
    playerWithFallbacks.cueVideoById(videoId);
    return true;
  }

  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

  if (typeof playerWithFallbacks.loadVideoByUrl === "function") {
    playerWithFallbacks.loadVideoByUrl(watchUrl);
    return true;
  }

  if (typeof playerWithFallbacks.cueVideoByUrl === "function") {
    playerWithFallbacks.cueVideoByUrl(watchUrl);
    return true;
  }

  return false;
}

export function PlayerExperience({
  currentVideo,
  queue,
  isLoggedIn,
  isAdmin = false,
  isDockedDesktop = false,
  seenVideoIds,
  onHideVideo,
  onAddVideoToPlaylist,
  onDockHideRequest,
  forcedUnavailableSignal = 0,
  forcedUnavailableMessage = null,
  isRouteResolving = false,
  routeLoadingLabel = "Loading video",
  routeLoadingMessage = "Loading video...",
}: PlayerExperienceProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedVideoId = searchParams.get("v");
  const activePlaylistId = searchParams.get("pl");
  const rawPlaylistItemIndex = searchParams.get("pli");
  const activePlaylistItemIndex =
    rawPlaylistItemIndex !== null && /^\d+$/.test(rawPlaylistItemIndex)
      ? Number(rawPlaylistItemIndex)
      : null;
  const playerElementRef = useRef<HTMLDivElement | null>(null);
  const playerFrameRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const overlayTimeoutRef = useRef<number | null>(null);
  const unavailableOverlayTimeoutRef = useRef<number | null>(null);
  const unavailableAutoActionTimeoutRef = useRef<number | null>(null);
  const playerLoadRefreshHintTimeoutRef = useRef<number | null>(null);
  const playerAutoReconnectTimeoutRef = useRef<number | null>(null);
  const manualTransitionMaskTimeoutRef = useRef<number | null>(null);
  const hasAutoReconnectAttemptedRef = useRef(false);
  const isPlayerReadyRef = useRef(false);
  const initialRequestedVideoIdRef = useRef<string | null>(requestedVideoId);
  const hasLeftInitialRequestedVideoRef = useRef(false);
  const isBootstrappingHistoryRef = useRef(true);
  const previousVideoIdRef = useRef<string | null>(null);
  const favouriteSaveTimeoutRef = useRef<number | null>(null);
  const footerPlaylistMenuRef = useRef<HTMLDivElement | null>(null);
  const shareToChatResetTimeoutRef = useRef<number | null>(null);
  const playerPreferencesSaveTimeoutRef = useRef<number | null>(null);
  const lyricsAvailabilityByVideoRef = useRef<Map<string, boolean>>(new Map());
  const [autoplayEnabled, setAutoplayEnabled] = useState(false);
  const [isPlayerPreferencesServerHydrated, setIsPlayerPreferencesServerHydrated] = useState(() => !isLoggedIn);
  const [copied, setCopied] = useState(false);
  const [shareToChatState, setShareToChatState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [favouriteSaveState, setFavouriteSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [footerPlaylistAddState, setFooterPlaylistAddState] = useState<"idle" | "saving" | "added" | "error">("idle");
  const [showFooterPlaylistMenu, setShowFooterPlaylistMenu] = useState(false);
  const [footerPlaylistMenuLoading, setFooterPlaylistMenuLoading] = useState(false);
  const [footerPlaylistMenuPlaylists, setFooterPlaylistMenuPlaylists] = useState<PlaylistSummary[]>([]);
  const [footerOpenAfterSelect, setFooterOpenAfterSelect] = useState(false);
  const [footerShowExistingList, setFooterShowExistingList] = useState(false);
  const [hideCurrentVideoState, setHideCurrentVideoState] = useState<"idle" | "saving">("idle");
  const [historyStack, setHistoryStack] = useState<string[]>([]);
  const [showNowPlayingOverlay, setShowNowPlayingOverlay] = useState(false);
  const [unavailableOverlayMessage, setUnavailableOverlayMessage] = useState<string | null>(null);
  const [unavailableOverlayRequiresOk, setUnavailableOverlayRequiresOk] = useState(false);
  const [showEndedChoiceOverlay, setShowEndedChoiceOverlay] = useState(false);
  const [endedChoiceFromUnavailable, setEndedChoiceFromUnavailable] = useState(false);
  const [endedChoiceReshuffleKey, setEndedChoiceReshuffleKey] = useState(0);
  const [endedChoiceGridExiting, setEndedChoiceGridExiting] = useState(false);
  const [endedChoiceHidingIds, setEndedChoiceHidingIds] = useState<string[]>([]);
  const [endedChoiceDismissedIds, setEndedChoiceDismissedIds] = useState<string[]>([]);
  const [endedChoiceAnimateCards, setEndedChoiceAnimateCards] = useState(true);
  const [endedChoiceHideSeen, setEndedChoiceHideSeen] = useSeenTogglePreference({
    key: ENDED_CHOICE_HIDE_SEEN_TOGGLE_KEY,
    isAuthenticated: isLoggedIn,
  });
  const [endedChoiceLoading, setEndedChoiceLoading] = useState(false);
  const [endedChoiceRemoteVideos, setEndedChoiceRemoteVideos] = useState<VideoRecord[]>([]);
  const endedChoiceRemoteVideosRef = useRef<VideoRecord[]>([]);
  const [playerClosedByEndOfVideo, setPlayerClosedByEndOfVideo] = useState(false);
  const [playlistChooserOpen, setPlaylistChooserOpen] = useState(false);
  const [overlayInstance, setOverlayInstance] = useState(0);
  const [playerHostMode, setPlayerHostMode] = useState<"nocookie" | "youtube">("nocookie");
  const [isManualTransitionMaskVisible, setIsManualTransitionMaskVisible] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [showPlayerRefreshHint, setShowPlayerRefreshHint] = useState(false);
  const [playerReloadNonce, setPlayerReloadNonce] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(100);
    const [isMuted, setIsMuted] = useState(false);
    const [showControls, setShowControls] = useState(false);
    const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false);
    const [showShareMenu, setShowShareMenu] = useState(false);
    const [showShareModal, setShowShareModal] = useState(false);
    const [shareModalCopied, setShareModalCopied] = useState(false);
    const [lyricsAvailableForCurrentVideo, setLyricsAvailableForCurrentVideo] = useState<boolean | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isScrubbing, setIsScrubbing] = useState(false);
    const progressIntervalRef = useRef<number | null>(null);
    const nowPlayingShownForVideoRef = useRef<string | null>(null);
    const nowPlayingLastVideoIdRef = useRef<string | null>(null);
    const nowPlayingLastTriggeredAtRef = useRef<number>(0);
    const reportedUnavailableVideoIdRef = useRef<string | null>(null);
    const autoplaySuppressedVideoIdRef = useRef<string | null>(null);
    const autoplayRouteTransitionRef = useRef(false);
    const pendingAutoAdvanceVideoIdRef = useRef<string | null>(null);
    const autoplayRecoveryRequestIdRef = useRef(0);
    const playAttemptedAtRef = useRef<number | null>(null);
    const stuckPlaybackRetryCountRef = useRef(0);
    const stuckPlaybackRetryTimeoutRef = useRef<number | null>(null);
    const stuckPlaybackWatchdogTimeoutRef = useRef<number | null>(null);
    const midPlaybackBufferingStartedAtRef = useRef<number | null>(null);
    const midPlaybackBufferingCheckTimeoutRef = useRef<number | null>(null);
    const nextVideoIdRef = useRef<string | null>(currentVideo.id);
    const nextPlaylistIndexRef = useRef<number | null>(null);
    const nextClearPlaylistRef = useRef(false);
    const activePlaylistIdRef = useRef<string | null>(activePlaylistId);
  const watchHistoryLevelRef = useRef<Map<string, number>>(new Map());
  const watchHistoryRefreshInFlightRef = useRef<Promise<boolean> | null>(null);
  const watchHistoryRefreshBlockedUntilRef = useRef(0);
  const [playlistQueueIds, setPlaylistQueueIds] = useState<string[]>([]);
  const [playlistQueueOwnerId, setPlaylistQueueOwnerId] = useState<string | null>(null);
  const [playlistRefreshTick, setPlaylistRefreshTick] = useState(0);
  const [routeAutoplayQueueIds, setRouteAutoplayQueueIds] = useState<string[]>([]);
  const [topFallbackVideos, setTopFallbackVideos] = useState<VideoRecord[]>([]);
  const [showAdminVideoEditModal, setShowAdminVideoEditModal] = useState(false);
  const [adminEditVideoRowId, setAdminEditVideoRowId] = useState<number | null>(null);
  const [adminEditTitle, setAdminEditTitle] = useState("");
  const [adminEditChannelTitle, setAdminEditChannelTitle] = useState("");
  const [localTitleOverride, setLocalTitleOverride] = useState<string | null>(null);
  const [localChannelTitleOverride, setLocalChannelTitleOverride] = useState<string | null>(null);
  const [adminEditParsedArtist, setAdminEditParsedArtist] = useState("");
  const [adminEditParsedTrack, setAdminEditParsedTrack] = useState("");
  const [adminEditParsedVideoType, setAdminEditParsedVideoType] = useState("");
  const [adminEditParseConfidence, setAdminEditParseConfidence] = useState("");
  const [adminEditDescription, setAdminEditDescription] = useState("");
  const [isAdminEditLoading, setIsAdminEditLoading] = useState(false);
  const [isAdminEditSaving, setIsAdminEditSaving] = useState(false);
  const [isAdminDeleting, setIsAdminDeleting] = useState(false);
  const [showAdminDeleteConfirmModal, setShowAdminDeleteConfirmModal] = useState(false);
  const [adminEditError, setAdminEditError] = useState<string | null>(null);
  const [adminEditStatus, setAdminEditStatus] = useState<string | null>(null);
  const endedChoiceOverlayRef = useRef<HTMLDivElement | null>(null);
  const endedChoicePrefetchRafRef = useRef<number | null>(null);
  const endedChoiceRowHeightRef = useRef(220);
  const endedChoiceUserScrolledRef = useRef(false);
  const endedChoiceFetchingRef = useRef(false);
  const endedChoiceHasMoreRef = useRef(true);
  const endedChoiceSkipRef = useRef(0);
  const endedChoiceAutoRetryBlockedUntilRef = useRef(0);
  const endedChoiceNoProgressStreakRef = useRef(0);
  const endedChoiceFailureStreakRef = useRef(0);
  const endedChoiceOverlayVisibleRef = useRef(false);
  const endedChoicePrewarmVideoIdRef = useRef<string | null>(null);
  const pointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const currentVideoRef = useRef(currentVideo);
  const autoplayEnabledRef = useRef(autoplayEnabled);
  const volumeRef = useRef(volume);
  const isMutedRef = useRef(isMuted);
  const persistMutedPreferenceOnNextSyncRef = useRef(false);
  const hasUserGesturePlaybackUnlockRef = useRef(false);
  const lastNonZeroVolumeRef = useRef(100);
  const hasActivePlaylistSequenceRef = useRef(false);
  const hasPlaybackStartedRef = useRef(false);
  const previousActivePlaylistIdRef = useRef<string | null>(activePlaylistId);
  autoplayEnabledRef.current = autoplayEnabled;
  volumeRef.current = volume;
  isMutedRef.current = isMuted;
  if (volume > 0) {
    lastNonZeroVolumeRef.current = volume;
  }
  activePlaylistIdRef.current = activePlaylistId;
  hasPlaybackStartedRef.current = hasPlaybackStarted;

  useEffect(() => {
    currentVideoRef.current = currentVideo;
    setLocalTitleOverride(null);
    setLocalChannelTitleOverride(null);
    setEndedChoiceLoading(false);
    setEndedChoiceRemoteVideos([]);
    setEndedChoiceAnimateCards(true);
    endedChoiceUserScrolledRef.current = false;
    endedChoiceFetchingRef.current = false;
    endedChoiceHasMoreRef.current = true;
    endedChoiceSkipRef.current = 0;
    endedChoiceAutoRetryBlockedUntilRef.current = 0;
    endedChoiceNoProgressStreakRef.current = 0;
    endedChoiceFailureStreakRef.current = 0;
    endedChoicePrewarmVideoIdRef.current = null;
  }, [currentVideo]);

  useEffect(() => {
    endedChoiceRemoteVideosRef.current = endedChoiceRemoteVideos;
  }, [endedChoiceRemoteVideos]);

  useEffect(() => {
    endedChoiceOverlayVisibleRef.current = showEndedChoiceOverlay;
  }, [showEndedChoiceOverlay]);

  useEffect(() => {
    return () => {
      if (endedChoicePrefetchRafRef.current !== null) {
        window.cancelAnimationFrame(endedChoicePrefetchRafRef.current);
        endedChoicePrefetchRafRef.current = null;
      }
    };
  }, []);

  function handleFullscreenToggle() {
    if (!document.fullscreenElement) {
      playerFrameRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    function handlePlaylistChooserStateChange(event: Event) {
      if (event instanceof CustomEvent) {
        const isOpen = event.detail?.isOpen ?? false;
        setPlaylistChooserOpen(isOpen);
      }
    }
    window.addEventListener("ytr:playlist-chooser-state", handlePlaylistChooserStateChange);
    return () => window.removeEventListener("ytr:playlist-chooser-state", handlePlaylistChooserStateChange);
  }, []);

  useEffect(() => {
    function handlePointerMove(event: MouseEvent) {
      pointerPositionRef.current = { x: event.clientX, y: event.clientY };
    }

    window.addEventListener("mousemove", handlePointerMove);
    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (shareToChatResetTimeoutRef.current !== null) {
        window.clearTimeout(shareToChatResetTimeoutRef.current);
        shareToChatResetTimeoutRef.current = null;
      }

      if (playerPreferencesSaveTimeoutRef.current !== null) {
        window.clearTimeout(playerPreferencesSaveTimeoutRef.current);
        playerPreferencesSaveTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!showShareModal) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowShareModal(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showShareModal]);

  useEffect(() => {
    if (!showFooterPlaylistMenu) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (!footerPlaylistMenuRef.current) {
        return;
      }

      if (event.target instanceof Node && !footerPlaylistMenuRef.current.contains(event.target)) {
        setShowFooterPlaylistMenu(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowFooterPlaylistMenu(false);
      }
    };

    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [showFooterPlaylistMenu]);

  useEffect(() => {
    if (!showFooterPlaylistMenu) {
      return;
    }

    void loadFooterPlaylistMenu();
  }, [showFooterPlaylistMenu]);

  useEffect(() => {
    const videoId = currentVideo.id;

    if (!videoId) {
      setLyricsAvailableForCurrentVideo(null);
      return;
    }

    const cachedAvailability = lyricsAvailabilityByVideoRef.current.get(videoId);
    if (cachedAvailability !== undefined) {
      setLyricsAvailableForCurrentVideo(cachedAvailability);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setLyricsAvailableForCurrentVideo(null);

    async function loadLyricsAvailability() {
      try {
        const response = await fetch(`/api/lyrics?v=${encodeURIComponent(videoId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as LyricsAvailabilityResponse | null;
        const isAvailable = Boolean(payload?.available);
        lyricsAvailabilityByVideoRef.current.set(videoId, isAvailable);

        if (!cancelled) {
          setLyricsAvailableForCurrentVideo(isAvailable);
        }
      } catch {
        // Keep button available when availability cannot be determined due to transient errors.
      }
    }

    void loadLyricsAvailability();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentVideo.id]);

  const playlistCurrentIndex = playlistQueueIds.findIndex((videoId) => videoId === currentVideo.id);
  const effectivePlaylistIndex =
    playlistCurrentIndex >= 0
      ? playlistCurrentIndex
      : activePlaylistItemIndex !== null &&
          activePlaylistItemIndex >= 0 &&
          activePlaylistItemIndex < playlistQueueIds.length
        ? activePlaylistItemIndex
        : null;
  const hasActivePlaylistSequence = Boolean(
    activePlaylistId &&
      playlistQueueIds.length > 0 &&
      effectivePlaylistIndex !== null,
  );
  const hasActivePlaylistContext = Boolean(
    activePlaylistId &&
    playlistQueueOwnerId === activePlaylistId &&
    playlistQueueIds.length > 0,
  );
  const hasActivePlaylistIntent = Boolean(activePlaylistId);
  hasActivePlaylistSequenceRef.current = hasActivePlaylistSequence;

  useEffect(() => {
    if (!autoplayEnabled) {
      return;
    }

    let cancelled = false;

    async function loadTopFallbackPool() {
      try {
        const response = await fetch(`/api/videos/top?count=${AUTOPLAY_FALLBACK_POOL_SIZE}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | {
              videos?: VideoRecord[];
            }
          | null;

        const ids = Array.isArray(payload?.videos)
          ? payload.videos.filter((video): video is VideoRecord => Boolean(video?.id))
          : [];

        if (!cancelled) {
          setTopFallbackVideos(ids);
        }
      } catch {
        // Keep existing fallback pool if loading fails.
      }
    }

    void loadTopFallbackPool();

    return () => {
      cancelled = true;
    };
  }, [autoplayEnabled]);

  useEffect(() => {
    if (!isDockedDesktop || !autoplayEnabled || Boolean(activePlaylistId)) {
      setRouteAutoplayQueueIds([]);
      return;
    }

    const onNewRoute = pathname === "/new";
    const onTop100Route = pathname === "/top100";
    const onFavouritesRoute = pathname === "/favourites";
    const onCategoryRoute = pathname.startsWith("/categories/");
    const onArtistRoute = pathname.startsWith("/artist/");

    if (!onNewRoute && !onTop100Route && !onFavouritesRoute && !onCategoryRoute && !onArtistRoute) {
      setRouteAutoplayQueueIds([]);
      return;
    }

    let cancelled = false;

    const extractVideoIds = (videos: VideoRecord[] | undefined) => (
      Array.isArray(videos)
        ? videos.map((video) => video?.id).filter((id): id is string => Boolean(id))
        : []
    );

    async function fetchHiddenVideoIdSet() {
      if (!isLoggedIn) {
        return new Set<string>();
      }

      try {
        const hiddenResponse = await fetchWithAuthRetry("/api/hidden-videos", { cache: "no-store" });
        if (!hiddenResponse.ok) {
          return new Set<string>();
        }

        const hiddenPayload = (await hiddenResponse.json().catch(() => null)) as { hiddenVideoIds?: string[] } | null;
        return new Set(Array.isArray(hiddenPayload?.hiddenVideoIds) ? hiddenPayload.hiddenVideoIds : []);
      } catch {
        return new Set<string>();
      }
    }

    async function loadRouteAutoplayQueue() {
      try {
        const hiddenSet = await fetchHiddenVideoIdSet();
        let rawIds: string[] = [];

        if (onNewRoute) {
          const response = await fetch(`/api/videos/newest?skip=0&take=${NEW_AUTOPLAY_PLAYLIST_SIZE}`, {
            cache: "no-store",
          });

          if (!response.ok) {
            return;
          }

          const payload = (await response.json().catch(() => null)) as { videos?: VideoRecord[] } | null;
          rawIds = extractVideoIds(payload?.videos);
        } else if (onTop100Route) {
          const response = await fetch(`/api/videos/top?count=${NEW_AUTOPLAY_PLAYLIST_SIZE}`, {
            cache: "no-store",
          });

          if (!response.ok) {
            return;
          }

          const payload = (await response.json().catch(() => null)) as { videos?: VideoRecord[] } | null;
          rawIds = extractVideoIds(payload?.videos);
        } else if (onFavouritesRoute) {
          const response = await fetchWithAuthRetry("/api/favourites", {
            cache: "no-store",
          });

          if (!response.ok) {
            return;
          }

          const payload = (await response.json().catch(() => null)) as { favourites?: VideoRecord[] } | null;
          rawIds = Array.isArray(payload?.favourites)
            ? payload.favourites.map((video) => video?.id).filter((id): id is string => Boolean(id))
            : [];
        } else if (onCategoryRoute) {
          const categorySlug = pathname.slice("/categories/".length).split("/")[0] ?? "";
          if (!categorySlug) {
            return;
          }

          const response = await fetch(
            `/api/categories/${encodeURIComponent(categorySlug)}?limit=${NEW_AUTOPLAY_PLAYLIST_SIZE}&offset=0`,
            {
              cache: "no-store",
            },
          );

          if (!response.ok) {
            return;
          }

          const payload = (await response.json().catch(() => null)) as { videos?: VideoRecord[] } | null;
          rawIds = extractVideoIds(payload?.videos);
        } else if (onArtistRoute) {
          const artistSlug = pathname.slice("/artist/".length).split("/")[0] ?? "";
          if (!artistSlug) {
            return;
          }

          const response = await fetch(`/api/artists/${encodeURIComponent(artistSlug)}`, {
            cache: "no-store",
          });

          if (!response.ok) {
            return;
          }

          const payload = (await response.json().catch(() => null)) as { videos?: VideoRecord[] } | null;
          rawIds = extractVideoIds(payload?.videos);
        }

        const dedupedVisibleIds = Array.from(new Set(rawIds.filter((videoId) => !hiddenSet.has(videoId))));

        if (!cancelled) {
          setRouteAutoplayQueueIds(dedupedVisibleIds);
        }
      } catch {
        if (!cancelled) {
          setRouteAutoplayQueueIds([]);
        }
      }
    }

    void loadRouteAutoplayQueue();

    return () => {
      cancelled = true;
    };
  }, [activePlaylistId, autoplayEnabled, isDockedDesktop, isLoggedIn, pathname]);

  function getRandomWatchNextId() {
    const queueIds = Array.from(new Set(queue.map((video) => video.id))).filter((videoId) => videoId !== currentVideo.id);
    const topFallbackVideoIds = Array.from(new Set(topFallbackVideos.map((video) => video.id))).filter(
      (videoId) => Boolean(videoId) && videoId !== currentVideo.id,
    );
    const blendedCandidateIds = Array.from(new Set([...queueIds, ...topFallbackVideoIds]));

    if (blendedCandidateIds.length === 0) {
      return null;
    }

    // Avoid recently played videos when possible so random-next feels fresh.
    const recentIds = Array.from(new Set([...historyStack].reverse()))
      .filter((videoId) => videoId !== currentVideo.id)
      .slice(0, RANDOM_NEXT_RECENT_EXCLUSION);
    const recentIdSet = new Set(recentIds);
    const freshBlendedIds = blendedCandidateIds.filter((videoId) => !recentIdSet.has(videoId));

    // Keep related/queue tracks discoverable, but diversify with a larger quality pool.
    const freshQueueIds = queueIds.filter((videoId) => !recentIdSet.has(videoId));
    const shouldUseTopFallback = freshQueueIds.length < 5;

    const selectionPool = shouldUseTopFallback
      ? (freshBlendedIds.length > 0 ? freshBlendedIds : blendedCandidateIds)
      : freshQueueIds;

    if (selectionPool.length === 0) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * selectionPool.length);
    return selectionPool[randomIndex] ?? null;
  }

  function resolvePlaylistStepTarget(step: 1 | -1) {
    if (!hasActivePlaylistContext || playlistQueueIds.length === 0) {
      return null;
    }

    const fallbackIndex = step > 0 ? 0 : Math.max(0, playlistQueueIds.length - 1);
    const baseIndex = effectivePlaylistIndex ?? fallbackIndex;
    const wrappedIndex =
      step > 0
        ? (baseIndex + 1) % playlistQueueIds.length
        : (baseIndex - 1 + playlistQueueIds.length) % playlistQueueIds.length;
    const videoId = playlistQueueIds[wrappedIndex] ?? null;

    if (!videoId) {
      return null;
    }

    return {
      videoId,
      playlistItemIndex: wrappedIndex,
      clearPlaylist: false,
    };
  }

  function resolveNextTarget() {
    if (activePlaylistId) {
      const nextPlaylistTarget = resolvePlaylistStepTarget(1);
      if (nextPlaylistTarget) {
        return nextPlaylistTarget;
      }

      // A playlist is selected but not ready yet; do not switch to random Watch Next.
      return null;
    }

    if (isDockedDesktop && autoplayEnabled && routeAutoplayQueueIds.length > 0) {
      const currentIndex = routeAutoplayQueueIds.findIndex((videoId) => videoId === currentVideo.id);
      const fallbackIndex = routeAutoplayQueueIds.findIndex((videoId) => videoId !== currentVideo.id);
      const nextIndex = currentIndex >= 0
        ? (currentIndex + 1) % routeAutoplayQueueIds.length
        : fallbackIndex;
      const nextId = nextIndex >= 0 ? routeAutoplayQueueIds[nextIndex] ?? null : null;

      if (nextId) {
        return {
          videoId: nextId,
          playlistItemIndex: null,
          clearPlaylist: true,
        };
      }
    }

    const randomWatchNextId = getRandomWatchNextId();

    if (!randomWatchNextId) {
      return null;
    }

    return {
      videoId: randomWatchNextId,
      playlistItemIndex: null,
      clearPlaylist: true,
    };
  }

  async function resolveAutoplayRecoveryTarget() {
    try {
      const response = await fetch(`/api/videos/top?count=${AUTOPLAY_FALLBACK_POOL_SIZE}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            videos?: VideoRecord[];
          }
        | null;

      const currentId = currentVideoRef.current.id;
      const fallbackIds = Array.isArray(payload?.videos)
        ? Array.from(new Set(payload.videos.map((video) => video.id))).filter((videoId) => Boolean(videoId) && videoId !== currentId)
        : [];

      if (fallbackIds.length === 0) {
        return null;
      }

      const recentIds = Array.from(new Set([...historyStack].reverse()))
        .filter((videoId) => videoId !== currentId)
        .slice(0, RANDOM_NEXT_RECENT_EXCLUSION);
      const recentIdSet = new Set(recentIds);
      const freshIds = fallbackIds.filter((videoId) => !recentIdSet.has(videoId));
      const selectionPool = freshIds.length > 0 ? freshIds : fallbackIds;
      const randomIndex = Math.floor(Math.random() * selectionPool.length);

      return selectionPool[randomIndex] ?? null;
    } catch {
      return null;
    }
  }

  const resolvedNextTarget = resolveNextTarget();
  nextVideoIdRef.current = resolvedNextTarget?.videoId ?? null;
  nextPlaylistIndexRef.current = resolvedNextTarget?.playlistItemIndex ?? null;
  nextClearPlaylistRef.current = resolvedNextTarget?.clearPlaylist ?? false;

  const hasPreviousTrack = hasActivePlaylistSequence
    ? playlistQueueIds.length > 1
    : historyStack.length >= 2;
  const safeDuration = Math.max(0, toSafeNumber(duration, 0));
  const safeCurrentTime = Math.max(0, Math.min(toSafeNumber(currentTime, 0), safeDuration || Number.MAX_SAFE_INTEGER));
  const progressPercent = safeDuration > 0 ? Math.min(100, Math.max(0, (safeCurrentTime / safeDuration) * 100)) : 0;
  const elapsedLabel = formatPlaybackTime(safeCurrentTime);
  const durationLabel = formatPlaybackTime(safeDuration);
  const shareUrl = buildCanonicalShareUrl(currentVideo.id);
  const displayTitle = localTitleOverride ?? currentVideo.title;
  const displayChannelTitle = localChannelTitleOverride ?? currentVideo.channelTitle;
  const hasArtistName = Boolean(displayChannelTitle && displayChannelTitle.trim().length > 0);
  const socialShareTargets = [
    {
      id: "x",
      label: "Share on X",
      href: `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(displayTitle)}`,
    },
    {
      id: "facebook",
      label: "Share on Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
    },
    {
      id: "reddit",
      label: "Share on Reddit",
      href: `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(displayTitle)}`,
    },
    {
      id: "linkedin",
      label: "Share on LinkedIn",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
    },
    {
      id: "whatsapp",
      label: "Share on WhatsApp",
      href: `https://api.whatsapp.com/send?text=${encodeURIComponent(`${displayTitle} ${shareUrl}`)}`,
    },
    {
      id: "telegram",
      label: "Share on Telegram",
      href: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(displayTitle)}`,
    },
    {
      id: "email",
      label: "Share by Email",
      href: `mailto:?subject=${encodeURIComponent(displayTitle)}&body=${encodeURIComponent(`Check this out: ${shareUrl}`)}`,
    },
  ] as const;
  const isInitialDeepLinkedSelection = Boolean(
    requestedVideoId
      && requestedVideoId === currentVideo.id
      && requestedVideoId === initialRequestedVideoIdRef.current
      && !hasLeftInitialRequestedVideoRef.current
      && !hasPlaybackStartedRef.current,
  );
  const endedChoiceSeedVideos = useMemo(() => {
    const deduped = new Map<string, NextChoiceVideo>();

    for (const video of [...queue, ...topFallbackVideos]) {
      if (!video?.id || video.id === currentVideo.id || deduped.has(video.id)) {
        continue;
      }

      deduped.set(video.id, video);
    }

    const all = [...deduped.values()].filter((video) => !endedChoiceDismissedIds.includes(video.id));
    const offset = (endedChoiceReshuffleKey * ENDED_CHOICE_SET_SIZE) % Math.max(all.length, 1);
    return [...all.slice(offset), ...all.slice(0, offset)];
  }, [queue, topFallbackVideos, currentVideo.id, endedChoiceReshuffleKey, endedChoiceDismissedIds]);

  const endedChoiceVideos = useMemo(() => {
    const deduped = new Map<string, NextChoiceVideo>();

    for (const video of [...endedChoiceSeedVideos.slice(0, ENDED_CHOICE_SET_SIZE), ...endedChoiceRemoteVideos]) {
      if (!video?.id || video.id === currentVideo.id || endedChoiceDismissedIds.includes(video.id) || deduped.has(video.id)) {
        continue;
      }

      deduped.set(video.id, video);
    }

    return [...deduped.values()];
  }, [endedChoiceSeedVideos, endedChoiceRemoteVideos, currentVideo.id, endedChoiceDismissedIds]);

  const hasSeenEndedChoiceVideos = isLoggedIn && endedChoiceVideos.some((video) => seenVideoIds?.has(video.id));
  const visibleEndedChoiceVideos = isLoggedIn && endedChoiceHideSeen
    ? endedChoiceVideos.filter((video) => !(seenVideoIds?.has(video.id) ?? false))
    : endedChoiceVideos;
  const endedChoiceGridVideos = useMemo(() => {
    if (!endedChoiceHideSeen) {
      return visibleEndedChoiceVideos;
    }

    const fullRowCount = Math.floor(visibleEndedChoiceVideos.length / 4) * 4;
    return visibleEndedChoiceVideos.slice(0, fullRowCount);
  }, [endedChoiceHideSeen, visibleEndedChoiceVideos]);
  const shouldShowEndedChoiceEmptyState = endedChoiceGridVideos.length === 0
    && !endedChoiceLoading
    && (!endedChoiceHideSeen || !endedChoiceHasMoreRef.current);
  const footerActionsBlocked = Boolean(unavailableOverlayMessage) || showEndedChoiceOverlay || playlistChooserOpen;
  const lyricsUnavailableForCurrentVideo = lyricsAvailableForCurrentVideo === false;
  const lyricsButtonDisabled = footerActionsBlocked || lyricsUnavailableForCurrentVideo;
  const isUpstreamConnectivityOverlay = unavailableOverlayMessage === UPSTREAM_CONNECTIVITY_OVERLAY_MESSAGE;
  const footerSelectablePlaylists = activePlaylistId
    ? footerPlaylistMenuPlaylists.filter((playlist) => playlist.id !== activePlaylistId)
    : footerPlaylistMenuPlaylists;
  const footerLastPlaylistId = typeof window !== "undefined"
    ? window.localStorage.getItem(LAST_PLAYLIST_ID_KEY)
    : null;
  const footerSamePlaylistId =
    footerLastPlaylistId
    && footerLastPlaylistId !== activePlaylistId
    && footerPlaylistMenuPlaylists.some((playlist) => playlist.id === footerLastPlaylistId)
      ? footerLastPlaylistId
      : null;
  // Also suppress the player on overlay pages when the user is waiting to choose the next video
  // (video ended with autoplay off). On "/", the choice overlay is shown instead.
  const suppressUnavailablePlaybackSurface = endedChoiceFromUnavailable || Boolean(unavailableOverlayMessage) || playerClosedByEndOfVideo || (showEndedChoiceOverlay && pathname !== "/");
  const showDockCloseButton = isDockedDesktop && pathname !== "/";
  const hasActivePlayback = isPlaying || safeCurrentTime > 0;
  const showRouteLikeLoadingCopy = isRouteResolving || isManualTransitionMaskVisible;
  const showPlayerLoadingOverlay = isManualTransitionMaskVisible
    || ((!isPlayerReady || isRouteResolving) && !hasActivePlayback);
  const playerFrameClassName = [
    "playerFrame",
    isPlayerReady ? "playerFrameLoaded" : "",
    showPlayerLoadingOverlay ? "playerFrameLoading" : "",
  ].filter(Boolean).join(" ");

  useEffect(() => {
    const initialRequestedVideoId = initialRequestedVideoIdRef.current;

    if (!initialRequestedVideoId) {
      return;
    }

    if (currentVideo.id !== initialRequestedVideoId) {
      hasLeftInitialRequestedVideoRef.current = true;
    }
  }, [currentVideo.id]);

  useEffect(() => {
    const handlePlaylistsUpdated = () => {
      setPlaylistRefreshTick((current) => current + 1);
    };

    window.addEventListener(PLAYLISTS_UPDATED_EVENT, handlePlaylistsUpdated);

    return () => {
      window.removeEventListener(PLAYLISTS_UPDATED_EVENT, handlePlaylistsUpdated);
    };
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !activePlaylistId) {
      setPlaylistQueueIds([]);
      setPlaylistQueueOwnerId(null);
      return;
    }

    const playlistId = activePlaylistId;

    let cancelled = false;

    // Prevent stale tracks from previous playlist driving next/autoplay while new playlist loads.
    setPlaylistQueueIds([]);
    setPlaylistQueueOwnerId(null);

    async function loadPlaylistSequence() {
      try {
        const response = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          if (!cancelled) {
            setPlaylistQueueIds([]);
            setPlaylistQueueOwnerId(null);
          }
          return;
        }

        const payload = (await response.json().catch(() => null)) as PlaylistPayload | null;

        if (!payload || !Array.isArray(payload.videos)) {
          if (!cancelled) {
            setPlaylistQueueIds([]);
            setPlaylistQueueOwnerId(null);
          }
          return;
        }

        const sequenceIds = payload.videos
          .map((video) => video.id)
          .filter((id): id is string => Boolean(id));

        if (!cancelled) {
          setPlaylistQueueIds(sequenceIds);
          setPlaylistQueueOwnerId(playlistId);
        }
      } catch {
        if (!cancelled) {
          setPlaylistQueueIds([]);
          setPlaylistQueueOwnerId(null);
        }
      }
    }

    void loadPlaylistSequence();

    return () => {
      cancelled = true;
    };
  }, [activePlaylistId, isLoggedIn, playlistRefreshTick]);

  function persistResumeSnapshot(wasPlaying: boolean, explicitTime?: number) {
    if (typeof window === "undefined") {
      return;
    }

    const runtimePlayer = playerRef.current;
    const canReadTime = typeof runtimePlayer?.getCurrentTime === "function";

    const time =
      explicitTime ??
      (canReadTime ? runtimePlayer.getCurrentTime() : undefined) ??
      currentTime;

    window.sessionStorage.setItem(
      RESUME_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        time,
        videoId: currentVideo.id,
        wasPlaying,
      }),
    );
  }

  function triggerNowPlayingOverlay() {
    if (overlayTimeoutRef.current) {
      window.clearTimeout(overlayTimeoutRef.current);
    }

    setOverlayInstance((value) => value + 1);
    setShowNowPlayingOverlay(true);

    overlayTimeoutRef.current = window.setTimeout(() => {
      setShowNowPlayingOverlay(false);
    }, 3200);
  }

  function clearUnavailableOverlayMessage() {
    if (unavailableOverlayTimeoutRef.current) {
      window.clearTimeout(unavailableOverlayTimeoutRef.current);
    }

    if (unavailableAutoActionTimeoutRef.current) {
      window.clearTimeout(unavailableAutoActionTimeoutRef.current);
      unavailableAutoActionTimeoutRef.current = null;
    }

    unavailableOverlayTimeoutRef.current = null;
    setUnavailableOverlayMessage(null);
    setUnavailableOverlayRequiresOk(false);
  }

  function acknowledgeUnavailableOverlay() {
    clearUnavailableOverlayMessage();

    if (!autoplayEnabledRef.current) {
      setEndedChoiceFromUnavailable(true);
      triggerEndOfVideoAction();
      return;
    }

    setEndedChoiceFromUnavailable(false);
    triggerEndOfVideoAction({ forceAutoplayAdvance: true });
  }

  function showUnavailableOverlayMessage(message?: string | null) {
    clearUnavailableOverlayMessage();
    clearStuckPlaybackRetryTimer();
    clearStuckPlaybackWatchdogTimer();
    clearMidPlaybackBufferingCheck();
    clearMidPlaybackBufferingCheck();

    setUnavailableOverlayMessage(message?.trim() || UNAVAILABLE_OVERLAY_MESSAGE);
    setShowEndedChoiceOverlay(false);
    // Never auto-advance away from an unavailable-track error.
    // Keep message centered on the player and require explicit user choice.
    setUnavailableOverlayRequiresOk(true);
    unavailableOverlayTimeoutRef.current = null;
  }

  function pauseActivePlayback() {
    if (progressIntervalRef.current) {
      window.clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }

    const runtimePlayer = playerRef.current;

    if (runtimePlayer && typeof runtimePlayer.pauseVideo === "function") {
      runtimePlayer.pauseVideo();
    }

    setIsPlaying(false);
  }

  function showManualTransitionMask() {
    pauseActivePlayback();
    setCurrentTime(0);
    setIsManualTransitionMaskVisible(true);

    if (manualTransitionMaskTimeoutRef.current !== null) {
      window.clearTimeout(manualTransitionMaskTimeoutRef.current);
      manualTransitionMaskTimeoutRef.current = null;
    }

    manualTransitionMaskTimeoutRef.current = window.setTimeout(() => {
      manualTransitionMaskTimeoutRef.current = null;
      setIsManualTransitionMaskVisible(false);
    }, MANUAL_TRANSITION_MASK_TIMEOUT_MS);
  }

  function clearStuckPlaybackRetryTimer() {
    if (stuckPlaybackRetryTimeoutRef.current !== null) {
      window.clearTimeout(stuckPlaybackRetryTimeoutRef.current);
      stuckPlaybackRetryTimeoutRef.current = null;
    }
  }

  function clearStuckPlaybackWatchdogTimer() {
    if (stuckPlaybackWatchdogTimeoutRef.current !== null) {
      window.clearTimeout(stuckPlaybackWatchdogTimeoutRef.current);
      stuckPlaybackWatchdogTimeoutRef.current = null;
    }
  }

  function clearMidPlaybackBufferingCheck() {
    if (midPlaybackBufferingCheckTimeoutRef.current !== null) {
      window.clearTimeout(midPlaybackBufferingCheckTimeoutRef.current);
      midPlaybackBufferingCheckTimeoutRef.current = null;
    }
    midPlaybackBufferingStartedAtRef.current = null;
  }

  function clearPlayerLoadRefreshHintTimer() {
    if (playerLoadRefreshHintTimeoutRef.current !== null) {
      window.clearTimeout(playerLoadRefreshHintTimeoutRef.current);
      playerLoadRefreshHintTimeoutRef.current = null;
    }
  }

  function clearPlayerAutoReconnectTimer() {
    if (playerAutoReconnectTimeoutRef.current !== null) {
      window.clearTimeout(playerAutoReconnectTimeoutRef.current);
      playerAutoReconnectTimeoutRef.current = null;
    }
  }

  function scheduleStuckPlaybackWatchdog(trigger: string) {
    clearStuckPlaybackWatchdogTimer();

    const targetVideoId = currentVideoRef.current.id;

    stuckPlaybackWatchdogTimeoutRef.current = window.setTimeout(() => {
      stuckPlaybackWatchdogTimeoutRef.current = null;

      void (async () => {
        if (currentVideoRef.current.id !== targetVideoId) {
          return;
        }

        const player = playerRef.current;
        const attemptedAt = playAttemptedAtRef.current;

        if (!player || !attemptedAt) {
          return;
        }

        const state = typeof player.getPlayerState === "function" ? player.getPlayerState() : -1;
        const durationValue = typeof player.getDuration === "function" ? toSafeNumber(player.getDuration(), 0) : 0;
        const currentPosition = typeof player.getCurrentTime === "function" ? toSafeNumber(player.getCurrentTime(), 0) : 0;
        const bufferingState = 3;
        const stillBlocked =
          state !== window.YT?.PlayerState.PLAYING
          && (durationValue <= 0 || (state === bufferingState && currentPosition < 1.5));

        if (!stillBlocked) {
          return;
        }

        const scheduledRetry = scheduleStuckPlaybackRetry("runtime-stuck-loading");

        if (scheduledRetry) {
          logPlayerDebug("runtime-block-check:retry-scheduled", {
            videoId: currentVideoRef.current.id,
            playerHostMode,
            durationValue,
            currentPosition,
            state,
            retryAttempt: stuckPlaybackRetryCountRef.current,
            trigger,
          });
          return;
        }

        const shouldSkip = await reportUnavailableFromPlayer("yt-player-upstream-connect-timeout");

        logPlayerDebug("runtime-block-check", {
          videoId: currentVideoRef.current.id,
          playerHostMode,
          shouldSkip,
          durationValue,
          currentPosition,
          state,
          retryAttempt: stuckPlaybackRetryCountRef.current,
          trigger,
        });

        if (shouldSkip) {
          autoplaySuppressedVideoIdRef.current = currentVideoRef.current.id;
        }

        playAttemptedAtRef.current = null;
        pauseActivePlayback();
        showUnavailableOverlayMessage(UPSTREAM_CONNECTIVITY_OVERLAY_MESSAGE);
      })();
    }, STUCK_PLAYBACK_CHECK_MS);
  }

  function notePlayAttempt() {
    playAttemptedAtRef.current = Date.now();
    scheduleStuckPlaybackWatchdog("play-attempt");
  }

  function canProgrammaticPlaybackStart() {
    return hasUserGesturePlaybackUnlockRef.current;
  }

  function shouldSuppressAutoplayForInitialPageLoad(videoId: string) {
    if (typeof window === "undefined") {
      return false;
    }

    if (window.__ytrInitialPageLoadAutoplaySuppressed) {
      return false;
    }

    if (window.__ytrInitialPageLoadVideoId === undefined) {
      window.__ytrInitialPageLoadVideoId = currentVideoRef.current.id;
    }

    const initialPageLoadVideoId = window.__ytrInitialPageLoadVideoId;
    const shouldSuppress = Boolean(initialPageLoadVideoId && videoId === initialPageLoadVideoId);

    if (!shouldSuppress) {
      return false;
    }

    window.__ytrInitialPageLoadAutoplaySuppressed = true;
    return true;
  }

  function scheduleStuckPlaybackRetry(trigger: string) {
    const attempt = stuckPlaybackRetryCountRef.current;

    if (attempt >= STUCK_PLAYBACK_MAX_RETRIES) {
      return false;
    }

    const targetVideoId = currentVideoRef.current.id;
    const delayMs = STUCK_PLAYBACK_RETRY_DELAYS_MS[Math.min(attempt, STUCK_PLAYBACK_RETRY_DELAYS_MS.length - 1)];
    const nextAttempt = attempt + 1;

    stuckPlaybackRetryCountRef.current = nextAttempt;
    clearStuckPlaybackRetryTimer();

    logPlayerDebug("stuck-playback:retry-scheduled", {
      videoId: targetVideoId,
      trigger,
      attempt: nextAttempt,
      delayMs,
      playerHostMode,
    });

    stuckPlaybackRetryTimeoutRef.current = window.setTimeout(() => {
      stuckPlaybackRetryTimeoutRef.current = null;

      if (currentVideoRef.current.id !== targetVideoId) {
        return;
      }

      const runtimePlayer = playerRef.current;
      if (!runtimePlayer) {
        return;
      }

      const didSwitch = switchPlayerVideo(runtimePlayer, targetVideoId);
      if (!didSwitch) {
        return;
      }

      if (!canProgrammaticPlaybackStart()) {
        logPlayerDebug("stuck-playback:retry-skipped-until-user-gesture", {
          videoId: targetVideoId,
          trigger,
          attempt: nextAttempt,
        });
        return;
      }

      notePlayAttempt();
      runtimePlayer.playVideo();

      logPlayerDebug("stuck-playback:retry-fired", {
        videoId: targetVideoId,
        trigger,
        attempt: nextAttempt,
      });
    }, delayMs);

    return true;
  }

  function scheduleMidPlaybackBufferingCheck(trigger: string) {
    clearMidPlaybackBufferingCheck();

    const targetVideoId = currentVideoRef.current.id;
    midPlaybackBufferingStartedAtRef.current = null;

    midPlaybackBufferingCheckTimeoutRef.current = window.setTimeout(() => {
      midPlaybackBufferingCheckTimeoutRef.current = null;

      if (currentVideoRef.current.id !== targetVideoId) {
        return;
      }

      const player = playerRef.current;
      if (!player) {
        return;
      }

      const state = typeof player.getPlayerState === "function" ? player.getPlayerState() : -1;
      const bufferingState = 3;
      const isBuffering = state === bufferingState;

      if (!isBuffering) {
        // No longer buffering, we're good
        midPlaybackBufferingStartedAtRef.current = null;
        return;
      }

      // Still buffering, track how long it's been
      if (midPlaybackBufferingStartedAtRef.current === null) {
        midPlaybackBufferingStartedAtRef.current = Date.now();
      }

      const bufferingDurationMs = Date.now() - midPlaybackBufferingStartedAtRef.current;

      if (bufferingDurationMs >= MID_PLAYBACK_BUFFERING_THRESHOLD_MS) {
        // Buffering has lasted too long, treat as upstream connectivity issue
        logPlayerDebug("mid-playback:buffering-timeout", {
          videoId: targetVideoId,
          bufferingDurationMs,
          playerHostMode,
        });

        autoplaySuppressedVideoIdRef.current = targetVideoId;
        showUnavailableOverlayMessage(UPSTREAM_CONNECTIVITY_OVERLAY_MESSAGE);
        return;
      }

      // Still within threshold, keep checking
      logPlayerDebug("mid-playback:buffering-check", {
        videoId: targetVideoId,
        bufferingDurationMs,
        trigger,
        playerHostMode,
      });

      scheduleMidPlaybackBufferingCheck("recurring");
    }, MID_PLAYBACK_BUFFERING_CHECK_MS);
  }

  async function reportWatchEvent(level: number, reason: "qualified" | "ended", explicitTime?: number, explicitDuration?: number) {
    const activeVideoId = currentVideoRef.current.id;
    const currentLevel = watchHistoryLevelRef.current.get(activeVideoId) ?? 0;
    if (currentLevel >= level) {
      return;
    }

    const player = playerRef.current;
    const positionSec = Math.max(
      0,
      Math.floor(
        explicitTime
          ?? (typeof player?.getCurrentTime === "function" ? toSafeNumber(player.getCurrentTime(), 0) : currentTime),
      ),
    );
    const durationSec = Math.max(
      0,
      Math.floor(
        explicitDuration
          ?? (typeof player?.getDuration === "function" ? toSafeNumber(player.getDuration(), 0) : duration),
      ),
    );
    const progressPercent = durationSec > 0
      ? Math.min(100, Math.max(0, (positionSec / durationSec) * 100))
      : 0;

    const hasPlaybackEvidence = hasPlaybackStartedRef.current || positionSec > 0 || progressPercent > 0;
    if (!hasPlaybackEvidence) {
      return;
    }

    watchHistoryLevelRef.current.set(activeVideoId, level);

    try {
      const requestPayload = {
        videoId: activeVideoId,
        reason,
        positionSec,
        durationSec,
        progressPercent,
      };

      const sendWatchHistory = async () => fetch("/api/watch-history", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      });

      const refreshAccessTokenForWatchHistory = async () => {
        const now = Date.now();

        if (watchHistoryRefreshBlockedUntilRef.current > now) {
          return false;
        }

        const inFlight = watchHistoryRefreshInFlightRef.current;
        if (inFlight) {
          return inFlight;
        }

        const pending = (async () => {
          try {
            const refreshResponse = await fetch("/api/auth/refresh", {
              method: "POST",
              credentials: "same-origin",
              headers: {
                "Content-Type": "application/json",
              },
              body: "{}",
            });

            if (!refreshResponse.ok) {
              watchHistoryRefreshBlockedUntilRef.current = Date.now() + 60_000;
              return false;
            }

            return true;
          } catch {
            watchHistoryRefreshBlockedUntilRef.current = Date.now() + 60_000;
            return false;
          }
        })();

        watchHistoryRefreshInFlightRef.current = pending;

        try {
          return await pending;
        } finally {
          if (watchHistoryRefreshInFlightRef.current === pending) {
            watchHistoryRefreshInFlightRef.current = null;
          }
        }
      };

      let response = await sendWatchHistory();

      if (!response.ok && (response.status === 401 || response.status === 403)) {
        const refreshed = await refreshAccessTokenForWatchHistory();
        if (refreshed) {
          response = await sendWatchHistory();
        }
      }

      if (!response.ok) {
        watchHistoryLevelRef.current.set(activeVideoId, currentLevel);
      } else {
        const payload = (await response.json().catch(() => null)) as { ok?: boolean } | null;
        if (!payload?.ok) {
          watchHistoryLevelRef.current.set(activeVideoId, currentLevel);
          return;
        }

        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(WATCH_HISTORY_UPDATED_EVENT, {
            detail: { videoId: activeVideoId },
          }));
        }
      }
    } catch {
      watchHistoryLevelRef.current.set(activeVideoId, currentLevel);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const savedAutoplay = window.localStorage.getItem(AUTOPLAY_KEY);
    const savedHistory = window.sessionStorage.getItem(HISTORY_KEY);

    setAutoplayEnabled(savedAutoplay === "true");

    const savedVolume = Number(window.localStorage.getItem(PLAYER_VOLUME_KEY));
    if (Number.isFinite(savedVolume)) {
      setVolume(Math.max(0, Math.min(100, savedVolume)));
    }

    const savedMuted = window.localStorage.getItem(PLAYER_MUTED_KEY);
    if (savedMuted === "true") {
      setIsMuted(true);
    } else if (savedMuted === "false") {
      setIsMuted(false);
    }

    if (savedHistory) {
      try {
        const parsedHistory = JSON.parse(savedHistory) as string[];
        setHistoryStack(parsedHistory);
      } catch {
        window.sessionStorage.removeItem(HISTORY_KEY);
      }
    }

    isBootstrappingHistoryRef.current = false;
  }, []);

  useEffect(() => {
    if (!isLoggedIn) {
      setIsPlayerPreferencesServerHydrated(true);
      return;
    }

    let cancelled = false;
    setIsPlayerPreferencesServerHydrated(false);

    const loadServerPlayerPreferences = async () => {
      try {
        const response = await fetch("/api/player-preferences", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as PlayerPreferencesResponse | null;

        if (cancelled || !payload) {
          return;
        }

        if (typeof payload.autoplayEnabled === "boolean") {
          setAutoplayEnabled(payload.autoplayEnabled);
        }

        if (typeof payload.volume === "number" && Number.isFinite(payload.volume)) {
          setVolume(normalizePlayerVolume(payload.volume, 100));
        }
      } catch {
        // Keep local fallback values when server preference loading fails.
      } finally {
        if (!cancelled) {
          setIsPlayerPreferencesServerHydrated(true);
        }
      }
    };

    void loadServerPlayerPreferences();

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(PLAYER_VOLUME_KEY, String(normalizePlayerVolume(volume, 100)));

    if (persistMutedPreferenceOnNextSyncRef.current) {
      window.localStorage.setItem(PLAYER_MUTED_KEY, String(isMuted));
      persistMutedPreferenceOnNextSyncRef.current = false;
    }
  }, [volume, isMuted]);

  useEffect(() => {
    if (!playerRef.current || !isPlayerReady) {
      return;
    }

    const nextVolume = normalizePlayerVolume(volume, 100);
    playerRef.current.setVolume(nextVolume);
  }, [isPlayerReady, volume]);

  useEffect(() => {
    if (!isLoggedIn || !isPlayerPreferencesServerHydrated || typeof window === "undefined") {
      return;
    }

    if (playerPreferencesSaveTimeoutRef.current !== null) {
      window.clearTimeout(playerPreferencesSaveTimeoutRef.current);
      playerPreferencesSaveTimeoutRef.current = null;
    }

    playerPreferencesSaveTimeoutRef.current = window.setTimeout(() => {
      playerPreferencesSaveTimeoutRef.current = null;

      void fetch("/api/player-preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          volume: normalizePlayerVolume(volume, 100),
        }),
      }).catch(() => {
        // Keep UI responsive when background preference persistence fails.
      });
    }, 250);
  }, [isLoggedIn, isPlayerPreferencesServerHydrated, volume]);

  useEffect(() => {
    if (isBootstrappingHistoryRef.current) {
      return;
    }

    setHistoryStack((currentHistory) => {
      if (currentHistory[currentHistory.length - 1] === currentVideo.id) {
        previousVideoIdRef.current = currentVideo.id;
        return currentHistory;
      }

      const nextHistory = [...currentHistory, currentVideo.id].slice(-HISTORY_LIMIT);
      window.sessionStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
      previousVideoIdRef.current = currentVideo.id;
      return nextHistory;
    });
  }, [currentVideo.id]);

  useEffect(() => {
    if (overlayTimeoutRef.current) {
      window.clearTimeout(overlayTimeoutRef.current);
      overlayTimeoutRef.current = null;
    }

    setShowNowPlayingOverlay(false);
    nowPlayingShownForVideoRef.current = null;
    nowPlayingLastVideoIdRef.current = null;
    nowPlayingLastTriggeredAtRef.current = 0;
    reportedUnavailableVideoIdRef.current = null;
    autoplaySuppressedVideoIdRef.current = null;
    playAttemptedAtRef.current = null;
    stuckPlaybackRetryCountRef.current = 0;
    clearStuckPlaybackRetryTimer();
    clearStuckPlaybackWatchdogTimer();
    clearUnavailableOverlayMessage();
    setShowEndedChoiceOverlay(false);
    setEndedChoiceFromUnavailable(false);
    setHasPlaybackStarted(false);
    hasPlaybackStartedRef.current = false;
    setShowControls(false);
    setIsManualTransitionMaskVisible(false);
    if (manualTransitionMaskTimeoutRef.current !== null) {
      window.clearTimeout(manualTransitionMaskTimeoutRef.current);
      manualTransitionMaskTimeoutRef.current = null;
    }
    logFlow("current-video:changed", {
      currentVideoId: currentVideo.id,
      queueSize: queue.length,
    });
  }, [currentVideo.id]);

  useEffect(() => {
    if (showEndedChoiceOverlay) {
      setShowFooterPlaylistMenu(false);
      setFooterShowExistingList(false);
    }
  }, [showEndedChoiceOverlay]);

  useEffect(() => {
    if (!suppressUnavailablePlaybackSurface) {
      return;
    }

    pauseActivePlayback();

    if (!playerClosedByEndOfVideo) {
      if (playerRef.current && typeof playerRef.current.destroy === "function") {
        playerRef.current.destroy();
        playerRef.current = null;
      }

      setIsPlayerReady(false);
    }

    setShowControls(false);
    setShowShareMenu(false);
  }, [playerClosedByEndOfVideo, suppressUnavailablePlaybackSurface]);

  useEffect(() => {
    if (suppressUnavailablePlaybackSurface || !playerFrameRef.current) {
      return;
    }
    
    const checkMouseOverPlayer = () => {
      if (playerFrameRef.current?.matches(":hover")) {
        setShowControls(true);
      }
    };
    
    requestAnimationFrame(checkMouseOverPlayer);
  }, [overlayInstance, suppressUnavailablePlaybackSurface]);

  useEffect(() => {
    if (forcedUnavailableSignal <= 0) {
      return;
    }

    const runtimePlayer = playerRef.current;
    const runtimeState =
      runtimePlayer && typeof runtimePlayer.getPlayerState === "function"
        ? runtimePlayer.getPlayerState()
        : -1;
    const runtimeTime =
      runtimePlayer && typeof runtimePlayer.getCurrentTime === "function"
        ? toSafeNumber(runtimePlayer.getCurrentTime(), 0)
        : 0;
    const playbackAlreadyEstablished =
      runtimeState === window.YT?.PlayerState.PLAYING
      || hasPlaybackStartedRef.current
      || runtimeTime > 1;

    if (playbackAlreadyEstablished) {
      logPlayerDebug("forced-unavailable:ignored-due-to-active-playback", {
        videoId: currentVideo.id,
        runtimeState,
        runtimeTime,
      });
      return;
    }

    pauseActivePlayback();
    showUnavailableOverlayMessage(forcedUnavailableMessage);
  }, [currentVideo.id, forcedUnavailableMessage, forcedUnavailableSignal]);

  useEffect(() => {
    // When an overlay page closes, the pointer may already be over the player.
    // Defer until after synthetic mouseleave events from removed DOM nodes have fired,
    // then check real hover state so we only show controls if the mouse is actually there.
    if (pathname === "/") {
      const id = window.setTimeout(() => {
        if (playerFrameRef.current?.matches(":hover")) {
          setShowControls(true);
        }
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, [pathname]);

  useEffect(() => {
    if (pathname === "/") {
      autoplayRouteTransitionRef.current = false;
      return;
    }

    // Pause auto-advance logic while browsing overlay routes without changing
    // the user's autoplay preference. Clicking a track should still start playback.
    autoplayRouteTransitionRef.current = true;
  }, [pathname]);

  useEffect(() => {
    function handleAdminOverlayEnter() {
      pauseActivePlayback();
    }

    window.addEventListener(ADMIN_OVERLAY_ENTER_EVENT, handleAdminOverlayEnter);
    return () => window.removeEventListener(ADMIN_OVERLAY_ENTER_EVENT, handleAdminOverlayEnter);
  }, []);

  useEffect(() => {
    function handleReplayRequest(event: Event) {
      if (!(event instanceof CustomEvent)) {
        return;
      }

      const requestedVideoId = typeof event.detail?.videoId === "string"
        ? event.detail.videoId
        : null;

      if (!requestedVideoId || requestedVideoId !== currentVideoRef.current.id) {
        return;
      }

      if (!showEndedChoiceOverlay) {
        return;
      }

      handleEndedChoiceWatchAgain();
    }

    window.addEventListener(REQUEST_VIDEO_REPLAY_EVENT, handleReplayRequest);
    return () => window.removeEventListener(REQUEST_VIDEO_REPLAY_EVENT, handleReplayRequest);
  }, [showEndedChoiceOverlay]);

  async function reportUnavailableFromPlayer(reason: string) {
    if (reportedUnavailableVideoIdRef.current === currentVideo.id) {
      logPlayerDebug("report-unavailable:already-reported", {
        videoId: currentVideo.id,
        reason,
      });
      return false;
    }

    reportedUnavailableVideoIdRef.current = currentVideo.id;

    try {
      const response = await fetch("/api/videos/unavailable", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          videoId: currentVideo.id,
          reason,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            skipped?: boolean;
            reason?: string;
          }
        | null;

      logPlayerDebug("report-unavailable:response", {
        videoId: currentVideo.id,
        reason,
        httpStatus: response.status,
        responseOk: response.ok,
        payload,
      });

      return Boolean(response.ok && payload?.ok && payload?.skipped !== true);
    } catch {
      // best-effort runtime reporting
      logPlayerDebug("report-unavailable:network-error", {
        videoId: currentVideo.id,
        reason,
      });
      return false;
    }
  }

  function handleReloadPlayerIframe() {
    clearUnavailableOverlayMessage();
    clearStuckPlaybackRetryTimer();
    clearStuckPlaybackWatchdogTimer();
    clearMidPlaybackBufferingCheck();
    clearPlayerLoadRefreshHintTimer();
    clearPlayerAutoReconnectTimer();
    setShowPlayerRefreshHint(false);

    if (playerRef.current && typeof playerRef.current.destroy === "function") {
      playerRef.current.destroy();
      playerRef.current = null;
    }

    setIsPlayerReady(false);
    setIsPlaying(false);
    setHasPlaybackStarted(false);
    hasPlaybackStartedRef.current = false;
    reportedUnavailableVideoIdRef.current = null;
    autoplaySuppressedVideoIdRef.current = null;
    playAttemptedAtRef.current = null;
    stuckPlaybackRetryCountRef.current = 0;
    setPlayerReloadNonce((currentNonce) => currentNonce + 1);
  }

  useEffect(() => {
    setIsPlayerReady(false);
    setIsPlaying(false);
    setCurrentTime(0);

    logPlayerDebug("player-effect:start", {
      videoId: currentVideo.id,
      playerHostMode,
      queueSize: queue.length,
    });

    if (typeof window === "undefined" || !playerElementRef.current) {
      return;
    }

    let cancelled = false;
    const embedOrigin = window.location.origin;

    const createPlayer = () => {
      if (!window.YT || !playerElementRef.current || cancelled) {
        return;
      }

      if (playerRef.current) {
        const didSwitch = switchPlayerVideo(playerRef.current, currentVideo.id);

        logFlow("player:switch-existing", {
          currentVideoId: currentVideo.id,
          didSwitch,
        });

        if (didSwitch) {
          setIsPlayerReady(true);

          if (typeof playerRef.current.getDuration === "function") {
            setDuration(toSafeNumber(playerRef.current.getDuration(), 0));
          }

          if (typeof playerRef.current.getVolume === "function") {
            setVolume(toSafeNumber(playerRef.current.getVolume(), 100));
          }

          setIsMuted(toSafeNumber(playerRef.current.getVolume(), 100) <= 0);

          if (autoplaySuppressedVideoIdRef.current !== currentVideo.id) {
            const forceAutoAdvancePlayback = pendingAutoAdvanceVideoIdRef.current === currentVideo.id;
            const suppressForInitialPageLoad = shouldSuppressAutoplayForInitialPageLoad(currentVideo.id);

            if ((!suppressForInitialPageLoad || forceAutoAdvancePlayback) && canProgrammaticPlaybackStart()) {
              notePlayAttempt();
              window.setTimeout(() => {
                if (!cancelled && playerRef.current) {
                  playerRef.current.playVideo();
                }
              }, 0);
            }
          }

          return;
        }

        if (typeof playerRef.current.destroy === "function") {
          playerRef.current.destroy();
        }

        playerRef.current = null;
      }

      playerRef.current = new window.YT.Player(playerElementRef.current, {
        host: playerHostMode === "nocookie" ? "https://www.youtube-nocookie.com" : "https://www.youtube.com",
        videoId: currentVideo.id,
        playerVars: {
          autoplay: 0,
          cc_load_policy: 0,
          controls: 0,
          disablekb: 1,
          enablejsapi: 1,
          fs: 0,
          iv_load_policy: 3,
          modestbranding: 1,
          origin: embedOrigin,
          playsinline: 1,
          rel: 0,
          // Deprecated but still accepted by some clients; keep as best-effort UI suppression.
          showinfo: 0,
        },
        events: {
          onReady: (event) => {
            logFlow("player:onReady", {
              currentVideoId: currentVideo.id,
            });
            setIsPlayerReady(true);
            const currentPlayerVolume = normalizePlayerVolume(event.target.getVolume(), 100);
            setVolume(currentPlayerVolume);
            setDuration(toSafeNumber(event.target.getDuration(), 0));

            event.target.setVolume(normalizePlayerVolume(volumeRef.current, currentPlayerVolume));

            logPlayerDebug("onReady", {
              videoId: currentVideo.id,
              playerHostMode,
              duration: toSafeNumber(event.target.getDuration(), 0),
              volume: toSafeNumber(event.target.getVolume(), 100),
            });

            const shouldResume = searchParams.get("resume") === "1";

            if (shouldResume) {
              const rawSnapshot = window.sessionStorage.getItem(RESUME_KEY);

              if (rawSnapshot) {
                try {
                  const parsed = JSON.parse(rawSnapshot) as {
                    savedAt?: number;
                    time?: number;
                    videoId?: string;
                    wasPlaying?: boolean;
                  };

                  if (parsed.videoId === currentVideo.id) {
                    const safeTime = Math.max(0, Math.min(parsed.time ?? 0, event.target.getDuration() || 0));

                    if (safeTime > 0) {
                      event.target.seekTo(safeTime, true);
                      setCurrentTime(safeTime);
                    }

                    if (parsed.wasPlaying && !isInitialDeepLinkedSelection && canProgrammaticPlaybackStart()) {
                      event.target.playVideo();
                    }
                  }
                } catch {
                  window.sessionStorage.removeItem(RESUME_KEY);
                }
              }

              const params = new URLSearchParams(searchParams.toString());
              params.delete("resume");
              router.replace(`${pathname}?${params.toString()}`);
            }

            if (autoplaySuppressedVideoIdRef.current !== currentVideo.id) {
              const forceAutoAdvancePlayback = pendingAutoAdvanceVideoIdRef.current === currentVideo.id;
              const suppressForInitialPageLoad = shouldSuppressAutoplayForInitialPageLoad(currentVideo.id);

              if ((!suppressForInitialPageLoad || forceAutoAdvancePlayback) && canProgrammaticPlaybackStart()) {
                notePlayAttempt();
                event.target.playVideo();
              }
            }
          },
          onStateChange: (event) => {
            logFlow("player:onStateChange", {
              currentVideoId: currentVideo.id,
              state: event.data,
            });
            const playing = event.data === window.YT?.PlayerState.PLAYING;
            setIsPlaying(playing);

            if (playerRef.current) {
              const latestTime = toSafeNumber(playerRef.current.getCurrentTime(), 0);
              setCurrentTime(latestTime);
              if (typeof playerRef.current.getVolume === "function") {
                setVolume(toSafeNumber(playerRef.current.getVolume(), 100));
              }
              if (typeof playerRef.current.getVolume === "function") {
                setIsMuted(toSafeNumber(playerRef.current.getVolume(), 100) <= 0);
              }
              persistResumeSnapshot(playing, latestTime);
            }

            if (playing) {
              const activeVideoId = currentVideoRef.current.id;

              if (pendingAutoAdvanceVideoIdRef.current === activeVideoId) {
                pendingAutoAdvanceVideoIdRef.current = null;
              }

              const runtimePlayerWithVideoData = playerRef.current as (YouTubePlayer & {
                getVideoData?: () => { video_id?: string | null };
              }) | null;
              const runtimeVideoId = runtimePlayerWithVideoData && typeof runtimePlayerWithVideoData.getVideoData === "function"
                ? (runtimePlayerWithVideoData.getVideoData()?.video_id ?? null)
                : null;

              if (runtimeVideoId && runtimeVideoId !== activeVideoId) {
                logPlayerDebug("onStateChange:ignore-stale-playing-event", {
                  activeVideoId,
                  runtimeVideoId,
                });
                return;
              }

              clearUnavailableOverlayMessage();
              clearStuckPlaybackRetryTimer();
              clearStuckPlaybackWatchdogTimer();
              clearMidPlaybackBufferingCheck();
              stuckPlaybackRetryCountRef.current = 0;
              playAttemptedAtRef.current = null;
              setHasPlaybackStarted(true);
              hasPlaybackStartedRef.current = true;

              const startedTime = playerRef.current && typeof playerRef.current.getCurrentTime === "function"
                ? toSafeNumber(playerRef.current.getCurrentTime(), 0)
                : currentTime;
              const startedDuration = playerRef.current && typeof playerRef.current.getDuration === "function"
                ? toSafeNumber(playerRef.current.getDuration(), 0)
                : duration;
              void reportWatchEvent(1, "qualified", startedTime, startedDuration);

              const now = Date.now();
              const duplicateNowPlayingPulse =
                nowPlayingShownForVideoRef.current === activeVideoId
                || (
                  nowPlayingLastVideoIdRef.current === activeVideoId
                  && (now - nowPlayingLastTriggeredAtRef.current) < 1800
                );

              if (!duplicateNowPlayingPulse) {
                triggerNowPlayingOverlay();
                nowPlayingShownForVideoRef.current = activeVideoId;
                nowPlayingLastVideoIdRef.current = activeVideoId;
                nowPlayingLastTriggeredAtRef.current = now;
              }
              if (progressIntervalRef.current) window.clearInterval(progressIntervalRef.current);
              progressIntervalRef.current = window.setInterval(() => {
                if (playerRef.current) {
                  const liveTime = toSafeNumber(playerRef.current.getCurrentTime(), 0);
                  const liveDuration = toSafeNumber(playerRef.current.getDuration(), 0);
                  const runtimeMuted = typeof playerRef.current.isMuted === "function"
                    ? Boolean(playerRef.current.isMuted())
                    : false;
                  if (runtimeMuted !== isMutedRef.current) {
                    setIsMuted(runtimeMuted);
                  }
                  setCurrentTime(liveTime);
                  setDuration(liveDuration);
                  persistResumeSnapshot(true, liveTime);

                  const activeVideoId = currentVideoRef.current.id;
                  const shouldPrewarmEndedChoice =
                    liveDuration > 0
                    && (liveDuration - liveTime) <= ENDED_CHOICE_PREFETCH_BEFORE_END_SECONDS
                    && endedChoicePrewarmVideoIdRef.current !== activeVideoId
                    && !endedChoiceOverlayVisibleRef.current
                    && !endedChoiceFetchingRef.current;

                  if (shouldPrewarmEndedChoice) {
                    endedChoicePrewarmVideoIdRef.current = activeVideoId;
                    endedChoiceUserScrolledRef.current = false;
                    endedChoiceHasMoreRef.current = true;
                    endedChoiceSkipRef.current = 0;
                    setEndedChoiceRemoteVideos([]);
                    void fetchEndedChoiceSets(ENDED_CHOICE_INITIAL_PREFETCH_SETS, { background: true });
                  }

                  const progressPercent = liveDuration > 0 ? (liveTime / liveDuration) * 100 : 0;
                  if (liveTime >= 3 || progressPercent >= 8) {
                    void reportWatchEvent(1, "qualified", liveTime, liveDuration);
                  }
                }
              }, 500);
            } else {
              if (progressIntervalRef.current) {
                window.clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
              }
            }

            if (event.data === window.YT?.PlayerState.ENDED) {
              const activeVideoId = currentVideoRef.current.id;
              const runtimePlayerWithVideoData = playerRef.current as (YouTubePlayer & {
                getVideoData?: () => { video_id?: string | null };
              }) | null;
              const runtimeVideoId = runtimePlayerWithVideoData && typeof runtimePlayerWithVideoData.getVideoData === "function"
                ? (runtimePlayerWithVideoData.getVideoData()?.video_id ?? null)
                : null;

              if (runtimeVideoId && runtimeVideoId !== activeVideoId) {
                logPlayerDebug("onStateChange:ignore-stale-ended-event", {
                  activeVideoId,
                  runtimeVideoId,
                });
                return;
              }

              const endedTime = playerRef.current && typeof playerRef.current.getCurrentTime === "function"
                ? toSafeNumber(playerRef.current.getCurrentTime(), 0)
                : currentTime;
              const endedDuration = playerRef.current && typeof playerRef.current.getDuration === "function"
                ? toSafeNumber(playerRef.current.getDuration(), 0)
                : duration;
              void reportWatchEvent(2, "ended", endedTime, endedDuration);
              triggerEndOfVideoAction();
            }

            // Detect if we're buffering after playback had started (mid-playback buffering)
            const bufferingState = 3;
            if (event.data === bufferingState && hasPlaybackStartedRef.current) {
              scheduleMidPlaybackBufferingCheck("state-change-to-buffering");
            }
          },
          onError: async (event) => {
            const activeVideoId = currentVideoRef.current.id;
            if (activeVideoId !== currentVideo.id) {
              // Ignore stale events emitted by a previously replaced player instance.
              return;
            }

            logPlayerDebug("onError", {
              videoId: currentVideo.id,
              playerHostMode,
              errorCode: event.data,
            });

            if (!UNAVAILABLE_PLAYER_CODES.has(event.data)) {
              return;
            }

            const runtimePlayer = playerRef.current;
            const runtimeState =
              runtimePlayer && typeof runtimePlayer.getPlayerState === "function"
                ? runtimePlayer.getPlayerState()
                : -1;
            const runtimeTime =
              runtimePlayer && typeof runtimePlayer.getCurrentTime === "function"
                ? toSafeNumber(runtimePlayer.getCurrentTime(), 0)
                : 0;
            const playbackAlreadyEstablished =
              runtimeState === window.YT?.PlayerState.PLAYING
              || hasPlaybackStartedRef.current
              || runtimeTime > 1;

            if (playbackAlreadyEstablished) {
              logPlayerDebug("onError:ignored-due-to-active-playback", {
                videoId: currentVideo.id,
                playerHostMode,
                errorCode: event.data,
                runtimeState,
                runtimeTime,
              });
              return;
            }

            if (playerHostMode === "nocookie") {
              // Some videos fail under youtube-nocookie for specific client contexts.
              // Retry once with the standard YouTube host before treating as unavailable.
              if (playerRef.current && typeof playerRef.current.destroy === "function") {
                playerRef.current.destroy();
                playerRef.current = null;
              }

              setIsPlayerReady(false);
              setPlayerHostMode("youtube");
              logPlayerDebug("onError:host-fallback", {
                videoId: currentVideo.id,
                from: "nocookie",
                to: "youtube",
                errorCode: event.data,
              });
              return;
            }

            const reason =
              event.data === 101 || event.data === 150
                ? `yt-player-age-or-owner-restricted-${event.data}`
                : `yt-player-error-${event.data}`;

            const shouldSkip = await reportUnavailableFromPlayer(reason);

            const postReportPlayer = playerRef.current;
            const postReportState =
              postReportPlayer && typeof postReportPlayer.getPlayerState === "function"
                ? postReportPlayer.getPlayerState()
                : -1;
            const postReportTime =
              postReportPlayer && typeof postReportPlayer.getCurrentTime === "function"
                ? toSafeNumber(postReportPlayer.getCurrentTime(), 0)
                : 0;
            const playbackEstablishedAfterReport =
              postReportState === window.YT?.PlayerState.PLAYING
              || hasPlaybackStartedRef.current
              || postReportTime > 1;

            logPlayerDebug("onError:shouldSkip", {
              videoId: currentVideo.id,
              reason,
              shouldSkip,
              postReportState,
              postReportTime,
              playbackEstablishedAfterReport,
            });

            if (playbackEstablishedAfterReport) {
              return;
            }

            if (shouldSkip) {
              autoplaySuppressedVideoIdRef.current = currentVideo.id;
              playAttemptedAtRef.current = null;
              pauseActivePlayback();
              showUnavailableOverlayMessage();
            }
          },
        },
      });
    };

    if (window.YT?.Player) {
      createPlayer();
    } else {
      const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');

      if (!existingScript) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        document.body.appendChild(script);
      }

      const previousReady = window.onYouTubeIframeAPIReady;

      window.onYouTubeIframeAPIReady = () => {
        previousReady?.();
        createPlayer();
      };
    }

    return () => {
      cancelled = true;
      clearStuckPlaybackRetryTimer();
      clearStuckPlaybackWatchdogTimer();
      clearMidPlaybackBufferingCheck();
    };
  }, [currentVideo.id, playerHostMode, playerReloadNonce]);

  useEffect(() => {
    clearPlayerLoadRefreshHintTimer();
    clearPlayerAutoReconnectTimer();

    if (!isPlayerReady) {
      playerLoadRefreshHintTimeoutRef.current = window.setTimeout(() => {
        playerLoadRefreshHintTimeoutRef.current = null;
        setShowPlayerRefreshHint(true);
      }, PLAYER_LOAD_REFRESH_HINT_DELAY_MS);

      if (!hasAutoReconnectAttemptedRef.current) {
        const targetVideoId = currentVideo.id;

        playerAutoReconnectTimeoutRef.current = window.setTimeout(() => {
          playerAutoReconnectTimeoutRef.current = null;

          if (hasAutoReconnectAttemptedRef.current) {
            return;
          }

          if (isPlayerReadyRef.current) {
            return;
          }

          if (currentVideoRef.current.id !== targetVideoId) {
            return;
          }

          hasAutoReconnectAttemptedRef.current = true;

          logPlayerDebug("player:auto-reconnect", {
            videoId: targetVideoId,
            delayMs: PLAYER_AUTO_RECONNECT_DELAY_MS,
          });

          handleReloadPlayerIframe();
        }, PLAYER_AUTO_RECONNECT_DELAY_MS);
      }
    } else {
      setShowPlayerRefreshHint(false);
    }

    return () => {
      clearPlayerLoadRefreshHintTimer();
      clearPlayerAutoReconnectTimer();
    };
  }, [isPlayerReady, currentVideo.id, playerReloadNonce]);

  useEffect(() => {
    isPlayerReadyRef.current = isPlayerReady;
  }, [isPlayerReady]);

  useEffect(() => {
    hasAutoReconnectAttemptedRef.current = false;
    clearPlayerAutoReconnectTimer();
  }, [currentVideo.id]);

  useEffect(() => {
    // Reset the end-of-video closure state when a new video is selected
    setPlayerClosedByEndOfVideo(false);
  }, [currentVideo.id]);

  useEffect(() => {
    // When returning to home route, restore the player. If it was closed due to
    // end-of-video, show the choice overlay so the user can pick what to watch next.
    if (pathname === "/") {
      setPlayerClosedByEndOfVideo((wasClosed) => {
        if (wasClosed) {
          setShowEndedChoiceOverlay(true);
          setShowControls(true);
          setShowShareMenu(false);
        }
        return false;
      });
    }
  }, [pathname]);

  useEffect(() => {
    const previousActivePlaylistId = previousActivePlaylistIdRef.current;

    // Deleting/closing a playlist should never leave the playback surface hidden.
    if (previousActivePlaylistId && !activePlaylistId) {
      setPlayerClosedByEndOfVideo(false);
    }

    previousActivePlaylistIdRef.current = activePlaylistId;
  }, [activePlaylistId]);

  useEffect(() => {
    return () => {
      if (overlayTimeoutRef.current) {
        window.clearTimeout(overlayTimeoutRef.current);
      }

      if (unavailableOverlayTimeoutRef.current) {
        window.clearTimeout(unavailableOverlayTimeoutRef.current);
      }

      if (unavailableAutoActionTimeoutRef.current) {
        window.clearTimeout(unavailableAutoActionTimeoutRef.current);
      }

      if (manualTransitionMaskTimeoutRef.current !== null) {
        window.clearTimeout(manualTransitionMaskTimeoutRef.current);
        manualTransitionMaskTimeoutRef.current = null;
      }

      clearStuckPlaybackRetryTimer();
      clearStuckPlaybackWatchdogTimer();

      if (progressIntervalRef.current) {
        window.clearInterval(progressIntervalRef.current);
      }

      if (playerRef.current) {
        const canReadState = typeof playerRef.current.getPlayerState === "function";
        const wasPlaying = canReadState
          ? playerRef.current.getPlayerState() === window.YT?.PlayerState.PLAYING
          : false;
        persistResumeSnapshot(wasPlaying);
      }

      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  function navigateToVideo(
    videoId: string,
    options?: {
      clearPlaylist?: boolean;
      playlistId?: string | null;
      playlistItemIndex?: number | null;
    },
  ) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("v", videoId);

    if (options?.clearPlaylist) {
      params.delete("pl");
      params.delete("pli");
    } else if (options?.playlistId) {
      params.set("pl", options.playlistId);

      if (options.playlistItemIndex !== null && options.playlistItemIndex !== undefined) {
        params.set("pli", String(options.playlistItemIndex));
      } else {
        params.delete("pli");
      }
    }

    router.push(`${pathname}?${params.toString()}`);
  }

  function triggerEndOfVideoAction(options?: { forceAutoplayAdvance?: boolean }) {
    const forceAutoplayAdvance = options?.forceAutoplayAdvance === true;
    // Keep autoplay preference intact, but suspend auto-advance while on overlay routes.
    const autoplayEnabledForCurrentTrack = autoplayEnabledRef.current && !autoplayRouteTransitionRef.current && currentVideo.id.length > 0;

    const shouldAutoAdvance =
      autoplayEnabledForCurrentTrack || forceAutoplayAdvance;

    if (shouldAutoAdvance && nextVideoIdRef.current) {
      pendingAutoAdvanceVideoIdRef.current = nextVideoIdRef.current;
      navigateToVideo(nextVideoIdRef.current, {
        clearPlaylist: nextClearPlaylistRef.current,
        playlistId: activePlaylistIdRef.current,
        playlistItemIndex: nextPlaylistIndexRef.current,
      });
      return;
    }

    if (shouldAutoAdvance && hasActivePlaylistIntent) {
      // Wait for selected playlist queue to load, then continue sequencing there.
      return;
    }

    if (shouldAutoAdvance && !hasActivePlaylistIntent) {
      const requestId = ++autoplayRecoveryRequestIdRef.current;
      const endedVideoId = currentVideo.id;

      void (async () => {
        const recoveredVideoId = await resolveAutoplayRecoveryTarget();

        if (requestId !== autoplayRecoveryRequestIdRef.current) {
          return;
        }

        if (!recoveredVideoId) {
          setEndedChoiceLoading(true);
          setShowEndedChoiceOverlay(true);
          setShowControls(true);
          setShowShareMenu(false);
          return;
        }

        if (currentVideoRef.current.id !== endedVideoId) {
          return;
        }

        pendingAutoAdvanceVideoIdRef.current = recoveredVideoId;
        navigateToVideo(recoveredVideoId, {
          clearPlaylist: true,
          playlistId: null,
          playlistItemIndex: null,
        });
      })();

      return;
    }

    if (!autoplayEnabledRef.current) {
      // When autoplay is off and player is in docked position, close the player instead of showing overlay
      const shouldCloseDockedSurface = false && isDockedDesktop && pathname !== "/";

      if (shouldCloseDockedSurface) {
        setPlayerClosedByEndOfVideo(true);
        return;
      }

      setPlayerClosedByEndOfVideo(false);
      setEndedChoiceLoading(true);
      setShowEndedChoiceOverlay(true);
      setShowControls(true);
      setShowShareMenu(false);
      return;
    }

    setEndedChoiceLoading(true);
    setShowEndedChoiceOverlay(true);
    setShowControls(true);
    setShowShareMenu(false);
  }

  const handleEndedChoiceSelect = useCallback((videoId: string) => {
    const playlistIndex = playlistQueueIds.findIndex((candidateId) => candidateId === videoId);

    hasUserGesturePlaybackUnlockRef.current = true;
    setShowEndedChoiceOverlay(false);
    setEndedChoiceFromUnavailable(false);
    navigateToVideo(videoId, {
      clearPlaylist: playlistIndex < 0,
      playlistId: playlistIndex >= 0 ? activePlaylistId : null,
      playlistItemIndex: playlistIndex >= 0 ? playlistIndex : null,
    });
  }, [activePlaylistId, navigateToVideo, playlistQueueIds]);

  async function fetchEndedChoiceSets(setCount: number, options?: { background?: boolean }) {
    const isBackground = options?.background === true;
    const applyRetryBackoff = (baseMs: number) => {
      if (!isBackground) {
        return;
      }

      const failureStreak = Math.max(1, endedChoiceFailureStreakRef.current);
      const cappedBackoff = Math.min(15_000, baseMs * Math.min(8, failureStreak));
      endedChoiceAutoRetryBlockedUntilRef.current = Date.now() + cappedBackoff;
    };

    if (isBackground && Date.now() < endedChoiceAutoRetryBlockedUntilRef.current) {
      return;
    }

    if (setCount <= 0 || endedChoiceFetchingRef.current || !endedChoiceHasMoreRef.current) {
      return;
    }

    const take = Math.max(1, setCount) * ENDED_CHOICE_SET_SIZE;
    const skip = endedChoiceSkipRef.current;
    endedChoiceFetchingRef.current = true;
    if (!isBackground) {
      setEndedChoiceLoading(true);
    }

    try {
      const params = new URLSearchParams();
      params.set("v", currentVideo.id);
      params.set("count", String(take));
      params.set("offset", String(skip));
      params.set("mode", "ended-choice");
      if (endedChoiceHideSeen) {
        params.set("hideSeen", "1");
      }

      const response = await fetch(`/api/current-video?${params.toString()}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        endedChoiceFailureStreakRef.current += 1;
        applyRetryBackoff(1_200);
        return;
      }

      endedChoiceFailureStreakRef.current = 0;

      const payload = (await response.json().catch(() => null)) as
        | {
            videos?: VideoRecord[];
            relatedVideos?: VideoRecord[];
            hasMore?: boolean;
          }
        | null;

      const fetchedVideosRaw = Array.isArray(payload?.relatedVideos)
        ? payload.relatedVideos
        : Array.isArray(payload?.videos)
          ? payload.videos
          : [];
      const fetchedVideos = fetchedVideosRaw.filter((video): video is VideoRecord => Boolean(video?.id) && video.id !== currentVideo.id);
      const payloadHasMore = payload?.hasMore !== false;
      endedChoiceSkipRef.current = skip + fetchedVideosRaw.length;

      if (fetchedVideos.length === 0 && !payloadHasMore) {
        endedChoiceHasMoreRef.current = false;
        endedChoiceNoProgressStreakRef.current = 0;
        return;
      }

      if (!payloadHasMore) {
        endedChoiceHasMoreRef.current = false;
      }

      if (fetchedVideos.length === 0) {
        endedChoiceNoProgressStreakRef.current += 1;
        if (endedChoiceNoProgressStreakRef.current >= 3) {
          // Repeated empty windows are a strong signal this pagination branch is exhausted.
          endedChoiceHasMoreRef.current = false;
        } else {
          applyRetryBackoff(1_500);
        }
        return;
      }

      const existingIds = new Set(endedChoiceRemoteVideosRef.current.map((video) => video.id));
      const uniqueToAdd = fetchedVideos.filter((video) => !existingIds.has(video.id));
      const addedCount = uniqueToAdd.length;

      if (addedCount > 0) {
        startTransition(() => {
          setEndedChoiceRemoteVideos((previous) => {
            const previousIds = new Set(previous.map((video) => video.id));
            const next = [...previous];

            for (const video of uniqueToAdd) {
              if (previousIds.has(video.id)) {
                continue;
              }

              previousIds.add(video.id);
              next.push(video);
            }

            return next;
          });
        });
      }

      if (addedCount <= 0) {
        endedChoiceNoProgressStreakRef.current += 1;
        if (endedChoiceNoProgressStreakRef.current >= 3) {
          endedChoiceHasMoreRef.current = false;
        } else {
          applyRetryBackoff(1_200);
        }
        return;
      }

      endedChoiceNoProgressStreakRef.current = 0;
      endedChoiceAutoRetryBlockedUntilRef.current = 0;

      if (skip > 0 || endedChoiceUserScrolledRef.current) {
        setEndedChoiceAnimateCards(false);
      }
    } catch {
      endedChoiceFailureStreakRef.current += 1;
      applyRetryBackoff(1_500);
      // Ignore transient failures; next scroll/prefetch will retry.
    } finally {
      if (!isBackground) {
        setEndedChoiceLoading(false);
      }
      endedChoiceFetchingRef.current = false;
    }
  }

  function getEndedChoiceColumns() {
    const width = endedChoiceOverlayRef.current?.clientWidth ?? window.innerWidth;
    if (width <= 640) {
      return 1;
    }

    if (width <= 920) {
      return 2;
    }

    return 4;
  }

  const measureEndedChoiceCard = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      return;
    }

    const next = node.offsetHeight + 12;
    if (next > 0) {
      endedChoiceRowHeightRef.current = next;
    }
  }, []);

  function computeCurrentEndedChoiceSetIndex() {
    const overlay = endedChoiceOverlayRef.current;
    if (!overlay) {
      return 0;
    }

    const columns = Math.max(1, getEndedChoiceColumns());
    const rowHeight = Math.max(1, endedChoiceRowHeightRef.current);
    const rowsScrolled = Math.max(0, Math.floor(overlay.scrollTop / rowHeight));
    const estimatedFirstVisibleIndex = rowsScrolled * columns;
    return Math.max(0, Math.floor(estimatedFirstVisibleIndex / ENDED_CHOICE_SET_SIZE));
  }

  function scheduleEndedChoicePrefetchCheck() {
    if (endedChoicePrefetchRafRef.current !== null) {
      return;
    }

    endedChoicePrefetchRafRef.current = window.requestAnimationFrame(() => {
      endedChoicePrefetchRafRef.current = null;

      if (!showEndedChoiceOverlay) {
        return;
      }

      const loadedSets = Math.ceil(Math.max(endedChoiceVideos.length, ENDED_CHOICE_SET_SIZE) / ENDED_CHOICE_SET_SIZE);

      if (!endedChoiceUserScrolledRef.current) {
        return;
      }

      const currentSetIndex = computeCurrentEndedChoiceSetIndex();
      const targetLoadedSets = currentSetIndex + ENDED_CHOICE_SCROLL_PREFETCH_BUFFER_SETS + 1;
      const missingSets = Math.max(0, targetLoadedSets - loadedSets);

      if (missingSets > 0) {
        void fetchEndedChoiceSets(missingSets, { background: true });
      }
    });
  }

  function handleEndedChoiceOverlayScroll(event: UIEvent<HTMLDivElement>) {
    if (!endedChoiceUserScrolledRef.current && event.currentTarget.scrollTop > 0) {
      endedChoiceUserScrolledRef.current = true;
      setEndedChoiceAnimateCards(false);
    }

    scheduleEndedChoicePrefetchCheck();
  }

  useEffect(() => {
    if (!showEndedChoiceOverlay) {
      return;
    }

    endedChoiceUserScrolledRef.current = false;

    const hasPrewarmedChoices =
      endedChoiceReshuffleKey === 0
      && endedChoicePrewarmVideoIdRef.current === currentVideo.id
      && endedChoiceRemoteVideos.length > 0;

    if (hasPrewarmedChoices) {
      setEndedChoiceLoading(false);
      return;
    }

    setEndedChoiceAnimateCards(true);
    endedChoiceHasMoreRef.current = true;
    endedChoiceSkipRef.current = 0;
    endedChoiceNoProgressStreakRef.current = 0;
    endedChoiceFailureStreakRef.current = 0;
    endedChoiceAutoRetryBlockedUntilRef.current = 0;
    setEndedChoiceRemoteVideos([]);
    void fetchEndedChoiceSets(ENDED_CHOICE_INITIAL_PREFETCH_SETS);
  }, [showEndedChoiceOverlay, currentVideo.id, endedChoiceReshuffleKey]);

  useEffect(() => {
    if (!showEndedChoiceOverlay || !endedChoiceUserScrolledRef.current) {
      return;
    }

    scheduleEndedChoicePrefetchCheck();
  }, [showEndedChoiceOverlay, endedChoiceVideos.length]);

  useEffect(() => {
    const needsSeenRowFill =
      visibleEndedChoiceVideos.length === 0
      || (endedChoiceHideSeen && visibleEndedChoiceVideos.length % 4 !== 0);

    if (
      !showEndedChoiceOverlay
      || !needsSeenRowFill
      || endedChoiceFetchingRef.current
      || !endedChoiceHasMoreRef.current
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void fetchEndedChoiceSets(1, { background: true });
    }, 140);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    currentVideo.id,
    endedChoiceHideSeen,
    endedChoiceVideos.length,
    showEndedChoiceOverlay,
    visibleEndedChoiceVideos.length,
  ]);

  function handleEndedChoiceReshuffle() {
    setEndedChoiceGridExiting(true);
    setTimeout(() => {
      endedChoiceUserScrolledRef.current = false;
      setEndedChoiceAnimateCards(true);
      endedChoiceHasMoreRef.current = true;
      endedChoiceSkipRef.current = 0;
      endedChoiceNoProgressStreakRef.current = 0;
      endedChoiceFailureStreakRef.current = 0;
      endedChoiceAutoRetryBlockedUntilRef.current = 0;
      endedChoicePrewarmVideoIdRef.current = null;
      setEndedChoiceRemoteVideos([]);
      setEndedChoiceReshuffleKey((k) => k + 1);
      setEndedChoiceGridExiting(false);
    }, 280);
  }

  const handleEndedChoiceHide = useCallback((track: VideoRecord) => {
    setEndedChoiceHidingIds((prev) => [...prev, track.id]);
    void onHideVideo?.(track);
    setTimeout(() => {
      setEndedChoiceHidingIds((prev) => prev.filter((id) => id !== track.id));
      setEndedChoiceDismissedIds((prev) => (prev.includes(track.id) ? prev : [...prev, track.id]));
    }, 400);
  }, [onHideVideo]);

  function handleEndedChoiceWatchAgain() {
    setShowEndedChoiceOverlay(false);
    setEndedChoiceFromUnavailable(false);
    setPlayerClosedByEndOfVideo(false);

    if (!playerRef.current) {
      return;
    }

    playerRef.current.seekTo(0, true);
    hasUserGesturePlaybackUnlockRef.current = true;
    notePlayAttempt();
    playerRef.current.playVideo();
  }

  function handlePrevious() {
    if (activePlaylistId) {
      const previousPlaylistTarget = resolvePlaylistStepTarget(-1);

      if (previousPlaylistTarget) {
        showManualTransitionMask();
        hasUserGesturePlaybackUnlockRef.current = true;
        pendingAutoAdvanceVideoIdRef.current = previousPlaylistTarget.videoId;
        navigateToVideo(previousPlaylistTarget.videoId, {
          playlistId: activePlaylistId,
          playlistItemIndex: previousPlaylistTarget.playlistItemIndex,
        });
        return;
      }

      // A playlist is selected but not ready yet; do not fall back to history.
      return;
    }

    const previousId = historyStack.at(-2);

    if (!previousId) {
      return;
    }

    const trimmedHistory = historyStack.slice(0, -1);
    setHistoryStack(trimmedHistory);
    window.sessionStorage.setItem(HISTORY_KEY, JSON.stringify(trimmedHistory));
    showManualTransitionMask();
    hasUserGesturePlaybackUnlockRef.current = true;
    pendingAutoAdvanceVideoIdRef.current = previousId;
    router.push(
      `${pathname}?${new URLSearchParams({ ...Object.fromEntries(searchParams.entries()), v: previousId }).toString()}`,
    );
  }

  function handleNext() {
    const nextTarget = resolveNextTarget();

    if (!nextTarget) {
      return;
    }

    showManualTransitionMask();
    hasUserGesturePlaybackUnlockRef.current = true;
    pendingAutoAdvanceVideoIdRef.current = nextTarget.videoId;
    navigateToVideo(nextTarget.videoId, {
      clearPlaylist: nextTarget.clearPlaylist,
      playlistId: activePlaylistId,
      playlistItemIndex: nextTarget.playlistItemIndex,
    });
  }

  async function handleHideCurrentVideo() {
    if (!isLoggedIn || hideCurrentVideoState === "saving") {
      return;
    }

    setHideCurrentVideoState("saving");
    showManualTransitionMask();

    try {
      const activePlaylistQuery = activePlaylistId ? `?activePlaylistId=${encodeURIComponent(activePlaylistId)}` : "";
      const response = await fetch(`/api/hidden-videos${activePlaylistQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: currentVideo.id }),
      });

      const payload = (await response.json().catch(() => null)) as {
        activePlaylistDeleted?: boolean;
      } | null;

      if (response.ok) {
        window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));

        if (payload?.activePlaylistDeleted) {
          const params = new URLSearchParams(searchParams.toString());
          params.delete("pl");
          params.delete("pli");
          activePlaylistIdRef.current = null;
          setPlaylistQueueIds([]);
          setPlaylistQueueOwnerId(null);
          const query = params.toString();
          router.replace(query ? `${pathname}?${query}` : pathname);
        }
      }
    } catch {
      // Keep skip flow responsive even if hide persistence fails.
    } finally {
      setHideCurrentVideoState("idle");
      triggerEndOfVideoAction({
        forceAutoplayAdvance: autoplayEnabledRef.current,
      });
    }
  }

  async function addCurrentTrackToPlaylist(playlistId: string) {
    const addResponse = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ videoId: currentVideo.id }),
    });

    if (!addResponse.ok) {
      return false;
    }

    window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
    return true;
  }

  async function loadFooterPlaylistMenu() {
    setFooterPlaylistMenuLoading(true);

    try {
      const response = await fetch("/api/playlists", {
        cache: "no-store",
      });

      if (!response.ok) {
        setFooterPlaylistMenuPlaylists([]);
        return;
      }

      const payload = (await response.json().catch(() => null)) as { playlists?: PlaylistSummary[] } | null;
      setFooterPlaylistMenuPlaylists(Array.isArray(payload?.playlists) ? payload.playlists : []);
    } catch {
      setFooterPlaylistMenuPlaylists([]);
    } finally {
      setFooterPlaylistMenuLoading(false);
    }
  }

  function markFooterPlaylistAdded() {
    setFooterPlaylistAddState("added");
    window.setTimeout(() => {
      setFooterPlaylistAddState((current) => (current === "added" ? "idle" : current));
    }, 1800);
  }

  async function handleFooterPlaylistButtonClick() {
    if (!isLoggedIn || footerPlaylistAddState === "saving") {
      return;
    }

    const shouldOpen = !showFooterPlaylistMenu;
    setShowFooterPlaylistMenu(shouldOpen);
    if (!shouldOpen) {
      setFooterShowExistingList(false);
    }
  }

  async function handleFooterPlaylistSelect(playlistId: string) {
    if (footerPlaylistAddState === "saving") {
      return;
    }

    setFooterPlaylistAddState("saving");

    try {
      const ok = await addCurrentTrackToPlaylist(playlistId);
      if (ok) {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(LAST_PLAYLIST_ID_KEY, playlistId);
        }
        markFooterPlaylistAdded();
        setShowFooterPlaylistMenu(false);
        setFooterShowExistingList(false);

        window.dispatchEvent(new CustomEvent(RIGHT_RAIL_MODE_EVENT, {
          detail: {
            mode: "playlist",
            playlistId,
            trackId: currentVideo.id,
          },
        }));

        if (footerOpenAfterSelect) {
          const params = new URLSearchParams(searchParams.toString());
          params.set("v", currentVideo.id);
          params.set("resume", "1");
          params.set("pl", playlistId);
          params.delete("pli");
          router.replace(`${pathname}?${params.toString()}`);
        }
        return;
      }
      setFooterPlaylistAddState("error");
    } catch {
      setFooterPlaylistAddState("error");
    }
  }

  async function handleFooterCreatePlaylistNoOpen() {
    if (footerPlaylistAddState === "saving") {
      return;
    }

    setFooterPlaylistAddState("saving");

    try {
      const createResponse = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: buildGeneratedPlaylistName(), videoIds: [] }),
      });

      if (!createResponse.ok) {
        setFooterPlaylistAddState("error");
        return;
      }

      const created = (await createResponse.json().catch(() => null)) as { id?: string } | null;
      if (!created?.id) {
        setFooterPlaylistAddState("error");
        return;
      }

      const added = await addCurrentTrackToPlaylist(created.id);
      if (!added) {
        setFooterPlaylistAddState("error");
        return;
      }

      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAST_PLAYLIST_ID_KEY, created.id);
      }

      markFooterPlaylistAdded();
      setShowFooterPlaylistMenu(false);
      setFooterShowExistingList(false);

      window.dispatchEvent(new CustomEvent(RIGHT_RAIL_MODE_EVENT, {
        detail: { mode: "playlist", playlistId: created.id, trackId: currentVideo.id },
      }));
    } catch {
      setFooterPlaylistAddState("error");
    }
  }

  async function handleFooterCreatePlaylist() {
    if (footerPlaylistAddState === "saving") {
      return;
    }

    setFooterPlaylistAddState("saving");

    try {
      const createResponse = await fetch("/api/playlists", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: buildGeneratedPlaylistName(),
          videoIds: [],
        }),
      });

      if (!createResponse.ok) {
        setFooterPlaylistAddState("error");
        return;
      }

      const created = (await createResponse.json().catch(() => null)) as { id?: string } | null;
      if (!created?.id) {
        setFooterPlaylistAddState("error");
        return;
      }

      const added = await addCurrentTrackToPlaylist(created.id);
      if (!added) {
        setFooterPlaylistAddState("error");
        return;
      }

      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAST_PLAYLIST_ID_KEY, created.id);
      }

      markFooterPlaylistAdded();
      setShowFooterPlaylistMenu(false);

      window.dispatchEvent(new CustomEvent(RIGHT_RAIL_MODE_EVENT, {
        detail: {
          mode: "playlist",
          playlistId: created.id,
          trackId: currentVideo.id,
        },
      }));

      const params = new URLSearchParams(searchParams.toString());
      params.set("v", currentVideo.id);
      params.set("resume", "1");
      params.set("pl", created.id);
      params.delete("pli");
      router.replace(`${pathname}?${params.toString()}`);
    } catch {
      setFooterPlaylistAddState("error");
    }
  }

  async function buildNewPageAutoplayPlaylist() {
    if (!isLoggedIn) {
      return { playlistId: null as string | null, firstVideoId: null as string | null };
    }

    try {
      const newestResponse = await fetch(
        `/api/videos/newest?skip=0&take=${NEW_AUTOPLAY_PLAYLIST_SIZE}`,
        {
          cache: "no-store",
        },
      );

      if (!newestResponse.ok) {
        return { playlistId: null as string | null, firstVideoId: null as string | null };
      }

      const newestPayload = (await newestResponse.json().catch(() => null)) as
        | {
            videos?: VideoRecord[];
          }
        | null;

      const rawVideoIds = Array.isArray(newestPayload?.videos)
        ? newestPayload.videos.map((video) => video.id).filter((id): id is string => Boolean(id))
        : [];

      if (rawVideoIds.length === 0) {
        return { playlistId: null as string | null, firstVideoId: null as string | null };
      }

      const hiddenResponse = await fetch("/api/hidden-videos", {
        cache: "no-store",
      });
      const hiddenPayload = hiddenResponse.ok
        ? ((await hiddenResponse.json().catch(() => null)) as { hiddenVideoIds?: string[] } | null)
        : null;
      const hiddenSet = new Set(Array.isArray(hiddenPayload?.hiddenVideoIds) ? hiddenPayload.hiddenVideoIds : []);

      const filteredVideoIds = Array.from(new Set(rawVideoIds.filter((videoId) => !hiddenSet.has(videoId)))).slice(
        0,
        NEW_AUTOPLAY_PLAYLIST_SIZE,
      );
      const firstVideoId = filteredVideoIds[0] ?? null;

      if (!firstVideoId) {
        return { playlistId: null as string | null, firstVideoId: null as string | null };
      }

      const now = new Date();
      const playlistName = `New autoplay ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

      const createResponse = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: playlistName,
          videoIds: filteredVideoIds,
        }),
      });

      if (!createResponse.ok) {
        return { playlistId: null as string | null, firstVideoId };
      }

      const playlistPayload = (await createResponse.json().catch(() => null)) as { id?: string } | null;
      const playlistId = typeof playlistPayload?.id === "string" ? playlistPayload.id : null;

      if (playlistId) {
        window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
      }

      return {
        playlistId,
        firstVideoId,
      };
    } catch {
      return { playlistId: null as string | null, firstVideoId: null as string | null };
    }
  }

  async function buildCategoryPageAutoplayPlaylist(categorySlug: string) {
    if (!isLoggedIn || !categorySlug) {
      return { playlistId: null as string | null, firstVideoId: null as string | null };
    }

    try {
      const categoryResponse = await fetch(
        `/api/categories/${encodeURIComponent(categorySlug)}?limit=96&offset=0`,
        {
          cache: "no-store",
        },
      );

      if (!categoryResponse.ok) {
        return { playlistId: null as string | null, firstVideoId: null as string | null };
      }

      const categoryPayload = (await categoryResponse.json().catch(() => null)) as
        | {
            videos?: VideoRecord[];
          }
        | null;

      const rawVideoIds = Array.isArray(categoryPayload?.videos)
        ? categoryPayload.videos.map((video) => video.id).filter((id): id is string => Boolean(id))
        : [];

      if (rawVideoIds.length === 0) {
        return { playlistId: null as string | null, firstVideoId: null as string | null };
      }

      const hiddenResponse = await fetch("/api/hidden-videos", {
        cache: "no-store",
      });
      const hiddenPayload = hiddenResponse.ok
        ? ((await hiddenResponse.json().catch(() => null)) as { hiddenVideoIds?: string[] } | null)
        : null;
      const hiddenSet = new Set(Array.isArray(hiddenPayload?.hiddenVideoIds) ? hiddenPayload.hiddenVideoIds : []);

      const filteredVideoIds = Array.from(new Set(rawVideoIds.filter((videoId) => !hiddenSet.has(videoId)))).slice(
        0,
        NEW_AUTOPLAY_PLAYLIST_SIZE,
      );
      const firstVideoId = filteredVideoIds[0] ?? null;

      if (!firstVideoId) {
        return { playlistId: null as string | null, firstVideoId: null as string | null };
      }

      const now = new Date();
      const readableCategory = decodeURIComponent(categorySlug).replace(/-/g, " ");
      const playlistName = `${readableCategory} autoplay ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

      const createResponse = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: playlistName,
          videoIds: filteredVideoIds,
        }),
      });

      if (!createResponse.ok) {
        return { playlistId: null as string | null, firstVideoId };
      }

      const playlistPayload = (await createResponse.json().catch(() => null)) as { id?: string } | null;
      const playlistId = typeof playlistPayload?.id === "string" ? playlistPayload.id : null;

      if (playlistId) {
        window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
      }

      return {
        playlistId,
        firstVideoId,
      };
    } catch {
      return { playlistId: null as string | null, firstVideoId: null as string | null };
    }
  }

  async function buildArtistPageAutoplayPlaylist(artistSlug: string) {
    if (!isLoggedIn || !artistSlug) {
      return { playlistId: null as string | null, firstVideoId: null as string | null };
    }

    try {
      const artistResponse = await fetch(`/api/artists/${encodeURIComponent(artistSlug)}`, {
        cache: "no-store",
      });

      if (!artistResponse.ok) {
        return { playlistId: null as string | null, firstVideoId: null as string | null };
      }

      const artistPayload = (await artistResponse.json().catch(() => null)) as
        | {
            videos?: VideoRecord[];
          }
        | null;

      const rawVideoIds = Array.isArray(artistPayload?.videos)
        ? artistPayload.videos.map((video) => video.id).filter((id): id is string => Boolean(id))
        : [];

      if (rawVideoIds.length === 0) {
        return { playlistId: null as string | null, firstVideoId: null as string | null };
      }

      const hiddenResponse = await fetch("/api/hidden-videos", {
        cache: "no-store",
      });
      const hiddenPayload = hiddenResponse.ok
        ? ((await hiddenResponse.json().catch(() => null)) as { hiddenVideoIds?: string[] } | null)
        : null;
      const hiddenSet = new Set(Array.isArray(hiddenPayload?.hiddenVideoIds) ? hiddenPayload.hiddenVideoIds : []);

      const filteredVideoIds = Array.from(new Set(rawVideoIds.filter((videoId) => !hiddenSet.has(videoId)))).slice(
        0,
        NEW_AUTOPLAY_PLAYLIST_SIZE,
      );
      const firstVideoId = filteredVideoIds[0] ?? null;

      if (!firstVideoId) {
        return { playlistId: null as string | null, firstVideoId: null as string | null };
      }

      const now = new Date();
      const readableArtist = decodeURIComponent(artistSlug).replace(/-/g, " ");
      const playlistName = `${readableArtist} autoplay ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

      const createResponse = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: playlistName,
          videoIds: filteredVideoIds,
        }),
      });

      if (!createResponse.ok) {
        return { playlistId: null as string | null, firstVideoId };
      }

      const playlistPayload = (await createResponse.json().catch(() => null)) as { id?: string } | null;
      const playlistId = typeof playlistPayload?.id === "string" ? playlistPayload.id : null;

      if (playlistId) {
        window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
      }

      return {
        playlistId,
        firstVideoId,
      };
    } catch {
      return { playlistId: null as string | null, firstVideoId: null as string | null };
    }
  }

  async function buildTop100AutoplayPlaylist() {
    if (!isLoggedIn) {
      return { playlistId: null as string | null, firstVideoId: null as string | null };
    }

    try {
      const topResponse = await fetch(`/api/videos/top?count=${NEW_AUTOPLAY_PLAYLIST_SIZE}`, {
        cache: "no-store",
      });

      if (!topResponse.ok) {
        return { playlistId: null as string | null, firstVideoId: null as string | null };
      }

      const topPayload = (await topResponse.json().catch(() => null)) as
        | {
            videos?: VideoRecord[];
          }
        | null;

      const rawVideoIds = Array.isArray(topPayload?.videos)
        ? topPayload.videos.map((video) => video.id).filter((id): id is string => Boolean(id))
        : [];

      if (rawVideoIds.length === 0) {
        return { playlistId: null as string | null, firstVideoId: null as string | null };
      }

      const hiddenResponse = await fetch("/api/hidden-videos", {
        cache: "no-store",
      });
      const hiddenPayload = hiddenResponse.ok
        ? ((await hiddenResponse.json().catch(() => null)) as { hiddenVideoIds?: string[] } | null)
        : null;
      const hiddenSet = new Set(Array.isArray(hiddenPayload?.hiddenVideoIds) ? hiddenPayload.hiddenVideoIds : []);

      const filteredVideoIds = Array.from(new Set(rawVideoIds.filter((videoId) => !hiddenSet.has(videoId)))).slice(
        0,
        NEW_AUTOPLAY_PLAYLIST_SIZE,
      );
      const firstVideoId = filteredVideoIds[0] ?? null;

      if (!firstVideoId) {
        return { playlistId: null as string | null, firstVideoId: null as string | null };
      }

      const now = new Date();
      const playlistName = `Top 100 autoplay ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

      const createResponse = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: playlistName,
          videoIds: filteredVideoIds,
        }),
      });

      if (!createResponse.ok) {
        return { playlistId: null as string | null, firstVideoId };
      }

      const playlistPayload = (await createResponse.json().catch(() => null)) as { id?: string } | null;
      const playlistId = typeof playlistPayload?.id === "string" ? playlistPayload.id : null;

      if (playlistId) {
        window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
      }

      return {
        playlistId,
        firstVideoId,
      };
    } catch {
      return { playlistId: null as string | null, firstVideoId: null as string | null };
    }
  }

  async function buildFavouritesAutoplayPlaylist() {
    if (!isLoggedIn) {
      return { playlistId: null as string | null, firstVideoId: null as string | null };
    }

    try {
      const favouritesResponse = await fetchWithAuthRetry("/api/favourites", {
        cache: "no-store",
      });

      if (!favouritesResponse.ok) {
        return { playlistId: null as string | null, firstVideoId: null as string | null };
      }

      const favouritesPayload = (await favouritesResponse.json().catch(() => null)) as
        | {
            favourites?: VideoRecord[];
          }
        | null;

      const rawVideoIds = Array.isArray(favouritesPayload?.favourites)
        ? favouritesPayload.favourites.map((video) => video.id).filter((id): id is string => Boolean(id))
        : [];

      if (rawVideoIds.length === 0) {
        return { playlistId: null as string | null, firstVideoId: null as string | null };
      }

      const filteredVideoIds = Array.from(new Set(rawVideoIds)).slice(0, NEW_AUTOPLAY_PLAYLIST_SIZE);
      const firstVideoId = filteredVideoIds[0] ?? null;

      if (!firstVideoId) {
        return { playlistId: null as string | null, firstVideoId: null as string | null };
      }

      const now = new Date();
      const playlistName = `Favourites autoplay ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

      const createResponse = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: playlistName,
          videoIds: filteredVideoIds,
        }),
      });

      if (!createResponse.ok) {
        return { playlistId: null as string | null, firstVideoId };
      }

      const playlistPayload = (await createResponse.json().catch(() => null)) as { id?: string } | null;
      const playlistId = typeof playlistPayload?.id === "string" ? playlistPayload.id : null;

      if (playlistId) {
        window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
      }

      return {
        playlistId,
        firstVideoId,
      };
    } catch {
      return { playlistId: null as string | null, firstVideoId: null as string | null };
    }
  }

  async function handleToggleAutoplay() {
    const enablingAutoplay = !autoplayEnabled;

    const persistAutoplayPreference = async (value: boolean) => {
      if (!isLoggedIn || !isPlayerPreferencesServerHydrated) {
        return;
      }

      try {
        await fetch("/api/player-preferences", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            autoplayEnabled: value,
          }),
        });
      } catch {
        // Preserve immediate toggle behavior even if background persistence fails.
      }
    };

    if (!enablingAutoplay) {
      setAutoplayEnabled(false);
      window.localStorage.setItem(AUTOPLAY_KEY, "false");
      void persistAutoplayPreference(false);
      return;
    }

    setAutoplayEnabled(true);
    window.localStorage.setItem(AUTOPLAY_KEY, "true");
    void persistAutoplayPreference(true);

    if (pathname === "/new") {
      autoplayRouteTransitionRef.current = true;
      const { playlistId, firstVideoId } = await buildNewPageAutoplayPlaylist();
      const targetVideoId = firstVideoId ?? currentVideo.id;
      const params = new URLSearchParams();
      params.set("v", targetVideoId);
      params.set("resume", "1");

      if (playlistId) {
        params.set("pl", playlistId);
        params.set("pli", "0");
      }

      router.push(`/?${params.toString()}`);
      return;
    }

    if (pathname.startsWith("/categories/")) {
      autoplayRouteTransitionRef.current = true;
      const categorySlug = pathname.slice("/categories/".length).split("/")[0] ?? "";
      const { playlistId, firstVideoId } = await buildCategoryPageAutoplayPlaylist(categorySlug);
      const targetVideoId = firstVideoId ?? currentVideo.id;
      const params = new URLSearchParams();
      params.set("v", targetVideoId);
      params.set("resume", "1");

      if (playlistId) {
        params.set("pl", playlistId);
        params.set("pli", "0");
      }

      router.push(`/?${params.toString()}`);
      return;
    }

    if (pathname.startsWith("/artist/")) {
      autoplayRouteTransitionRef.current = true;
      const artistSlug = pathname.slice("/artist/".length).split("/")[0] ?? "";
      const { playlistId, firstVideoId } = await buildArtistPageAutoplayPlaylist(artistSlug);
      const targetVideoId = firstVideoId ?? currentVideo.id;
      const params = new URLSearchParams();
      params.set("v", targetVideoId);
      params.set("resume", "1");

      if (playlistId) {
        params.set("pl", playlistId);
        params.set("pli", "0");
      }

      router.push(`/?${params.toString()}`);
      return;
    }

    if (pathname === "/top100") {
      autoplayRouteTransitionRef.current = true;
      const { playlistId, firstVideoId } = await buildTop100AutoplayPlaylist();
      const targetVideoId = firstVideoId ?? currentVideo.id;
      const params = new URLSearchParams();
      params.set("v", targetVideoId);
      params.set("resume", "1");

      if (playlistId) {
        params.set("pl", playlistId);
        params.set("pli", "0");
      }

      router.push(`/?${params.toString()}`);
      return;
    }

    if (pathname === "/favourites") {
      autoplayRouteTransitionRef.current = true;
      const { playlistId, firstVideoId } = await buildFavouritesAutoplayPlaylist();
      const targetVideoId = firstVideoId ?? currentVideo.id;
      const params = new URLSearchParams();
      params.set("v", targetVideoId);
      params.set("resume", "1");

      if (playlistId) {
        params.set("pl", playlistId);
        params.set("pli", "0");
      }

      router.push(`/?${params.toString()}`);
      return;
    }

    if (pathname !== "/") {
      autoplayRouteTransitionRef.current = true;
      const params = new URLSearchParams(searchParams.toString());
      params.set("v", currentVideo.id);
      router.push(`/?${params.toString()}`);
    }
  }

  async function handleAddFavourite() {
    setFavouriteSaveState("saving");
    try {
      const response = await fetchWithAuthRetry("/api/favourites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: currentVideo.id, action: "add" }),
      });

      if (response.ok) {
        window.dispatchEvent(new Event("ytr:favourites-updated"));
      }

      setFavouriteSaveState(response.ok ? "saved" : "error");
    } catch {
      setFavouriteSaveState("error");
    }
    if (favouriteSaveTimeoutRef.current !== null) {
      window.clearTimeout(favouriteSaveTimeoutRef.current);
    }
    favouriteSaveTimeoutRef.current = window.setTimeout(() => {
      setFavouriteSaveState("idle");
      favouriteSaveTimeoutRef.current = null;
    }, 2000);
  }

  function handleOpenLyrics() {
    if (lyricsUnavailableForCurrentVideo) {
      return;
    }

    window.dispatchEvent(new CustomEvent(RIGHT_RAIL_LYRICS_OPEN_EVENT, {
      detail: { videoId: currentVideo.id },
    }));
  }

  async function handleCopyShareLink() {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl);
    } else {
      window.prompt("Copy this link", shareUrl);
    }

    setCopied(true);

    window.setTimeout(() => {
      setCopied(false);
    }, 1600);
  }

  function handleDockClose() {
    setShowShareMenu(false);
    pauseActivePlayback();
    onDockHideRequest?.();
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("ytr:dock-hide-request"));
  }

      async function handleShareToChat() {
        if (!isLoggedIn) {
          await handleCopyShareLink();
          setShowShareMenu(false);
          return;
        }

        const content = buildSharedVideoMessage(currentVideo.id);
        if (!content) {
          setShareToChatState("error");
          return;
        }

        setShareToChatState("sending");
        try {
          const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "global",
              content,
            }),
          });

          if (!response.ok) {
            throw new Error(`share-chat-failed:${response.status}`);
          }

          setShareToChatState("sent");
        } catch {
          setShareToChatState("error");
        }

        if (shareToChatResetTimeoutRef.current !== null) {
          window.clearTimeout(shareToChatResetTimeoutRef.current);
        }

        shareToChatResetTimeoutRef.current = window.setTimeout(() => {
          setShareToChatState("idle");
          shareToChatResetTimeoutRef.current = null;
        }, 1800);

        setShowShareMenu(false);
      }

      async function handleShareToSocials() {
        setShareModalCopied(false);
        setShowShareModal(true);
        setShowShareMenu(false);
      }

      function handleShareTargetOpen(targetUrl: string) {
        window.open(targetUrl, "_blank", "noopener,noreferrer");
      }

      async function handleCopyShareUrlForModal() {
        await handleCopyShareLink();
        setShareModalCopied(true);

        window.setTimeout(() => {
          setShareModalCopied(false);
        }, 1600);
      }

      function handlePlayPause() {
        if (!playerRef.current) return;
        setShowEndedChoiceOverlay(false);
        if (isPlaying) {
          playerRef.current.pauseVideo();
        } else {
          hasUserGesturePlaybackUnlockRef.current = true;
          notePlayAttempt();
          playerRef.current.playVideo();
        }
      }

      function handleSeek(e: ChangeEvent<HTMLInputElement>) {
        if (!playerRef.current) return;
        const seconds = toSafeNumber(Number(e.target.value), 0);
        playerRef.current.seekTo(seconds, true);
        setCurrentTime(seconds);
      }

      function handleVolumeChange(e: ChangeEvent<HTMLInputElement>) {
        const vol = toSafeNumber(Number(e.target.value), 0);

        persistMutedPreferenceOnNextSyncRef.current = true;
        setVolume(vol);
        setIsMuted(vol <= 0);

        if (!playerRef.current) {
          return;
        }

        playerRef.current.setVolume(vol);
      }

      function handleMuteToggle() {
        if (!playerRef.current) return;
        persistMutedPreferenceOnNextSyncRef.current = true;
        if (isMuted) {
          const restoredVolume = Math.max(1, toSafeNumber(lastNonZeroVolumeRef.current, 100));
          playerRef.current.setVolume(restoredVolume);
          setVolume(restoredVolume);
          setIsMuted(false);
        } else {
          const currentVolume = Math.max(0, toSafeNumber(volumeRef.current, 100));
          if (currentVolume > 0) {
            lastNonZeroVolumeRef.current = currentVolume;
          }
          playerRef.current.setVolume(0);
          setVolume(0);
          setIsMuted(true);
        }
      }

      const overlayVolumeValue = isMuted
        ? 0
        : Math.max(0, Math.min(100, toSafeNumber(volume, 100)));

      async function handleOpenAdminVideoEdit() {
        if (!isAdmin) {
          return;
        }

        setShowAdminVideoEditModal(true);
        setIsAdminEditLoading(true);
        setAdminEditError(null);
        setAdminEditStatus(null);

        try {
          const response = await fetch(`/api/admin/videos?q=${encodeURIComponent(currentVideo.id)}`, {
            method: "GET",
            cache: "no-store",
          });

          if (!response.ok) {
            setAdminEditError("Could not load video details.");
            return;
          }

          const payload = (await response.json().catch(() => null)) as { videos?: AdminEditableVideo[] } | null;
          const row = Array.isArray(payload?.videos)
            ? payload.videos.find((video) => video.videoId === currentVideo.id) ?? null
            : null;

          if (!row) {
            setAdminEditError("Video record not found.");
            return;
          }

          setAdminEditVideoRowId(row.id);
          setAdminEditTitle(row.title ?? "");
          setAdminEditChannelTitle(row.channelTitle ?? "");
          setAdminEditParsedArtist(row.parsedArtist ?? "");
          setAdminEditParsedTrack(row.parsedTrack ?? "");
          setAdminEditParsedVideoType(row.parsedVideoType ?? "");
          setAdminEditParseConfidence(
            row.parseConfidence === null || row.parseConfidence === undefined
              ? ""
              : String(row.parseConfidence),
          );
          setAdminEditDescription(row.description ?? "");
        } catch {
          setAdminEditError("Could not load video details.");
        } finally {
          setIsAdminEditLoading(false);
        }
      }

      async function handleSaveAdminVideoEdit() {
        if (!isAdmin || !adminEditVideoRowId) {
          return;
        }

        setIsAdminEditSaving(true);
        setAdminEditError(null);
        setAdminEditStatus(null);

        const confidenceValue = adminEditParseConfidence.trim();
        let parseConfidence: number | null = null;

        if (confidenceValue.length > 0) {
          const parsed = Number(confidenceValue);
          if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
            setAdminEditError("Parse confidence must be between 0 and 1.");
            setIsAdminEditSaving(false);
            return;
          }
          parseConfidence = parsed;
        }

        try {
          const response = await fetch("/api/admin/videos", {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              id: adminEditVideoRowId,
              title: adminEditTitle,
              channelTitle: adminEditChannelTitle,
              parsedArtist: adminEditParsedArtist,
              parsedTrack: adminEditParsedTrack,
              parsedVideoType: adminEditParsedVideoType,
              parseConfidence,
              description: adminEditDescription,
            }),
          });

          if (!response.ok) {
            setAdminEditError("Could not save video changes.");
            return;
          }

          setAdminEditStatus("Saved.");
          setLocalTitleOverride(adminEditTitle);
          setLocalChannelTitleOverride(adminEditChannelTitle);
          closeAdminVideoEditModal();
          router.refresh();
        } catch {
          setAdminEditError("Could not save video changes.");
        } finally {
          setIsAdminEditSaving(false);
        }
      }

      function closeAdminVideoEditModal() {
        setShowAdminVideoEditModal(false);

        if (typeof window === "undefined") {
          return;
        }

        window.requestAnimationFrame(() => {
          const frame = playerFrameRef.current;
          if (!frame) {
            return;
          }

          const isHoveringFrame = frame.matches(":hover");
          const pointer = pointerPositionRef.current;
          const frameRect = frame.getBoundingClientRect();
          const pointerInsideFrame = Boolean(
            pointer
            && pointer.x >= frameRect.left
            && pointer.x <= frameRect.right
            && pointer.y >= frameRect.top
            && pointer.y <= frameRect.bottom,
          );

          if (isHoveringFrame || pointerInsideFrame) {
            setShowControls(true);
          }
        });
      }

      async function handleAdminDeleteCurrentVideo() {
        if (!isAdmin || isAdminDeleting) {
          return;
        }

        const deletingVideoId = currentVideo.id;
        setIsAdminDeleting(true);
        setShowAdminDeleteConfirmModal(false);
        setShowShareMenu(false);
        setAdminEditError(null);
        setAdminEditStatus(null);
        pauseActivePlayback();

        try {
          const response = await fetch("/api/admin/videos", {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              videoId: deletingVideoId,
            }),
          });

          if (!response.ok) {
            showUnavailableOverlayMessage("Could not remove this video from the site.");
            return;
          }

          window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
          window.dispatchEvent(new Event("ytr:favourites-updated"));
          window.dispatchEvent(new CustomEvent("ytr:video-catalog-deleted", { detail: { videoId: deletingVideoId } }));
          setPlaylistQueueIds((currentIds) => currentIds.filter((id) => id !== deletingVideoId));

          // Clear the deleted selection from the URL immediately so the resolver
          // cannot briefly re-request the just-deleted video during transition.
          const clearedParams = new URLSearchParams(searchParams.toString());
          const selectedVideoId = clearedParams.get("v");
          if (selectedVideoId === deletingVideoId) {
            clearedParams.delete("v");
            clearedParams.delete("pl");
            clearedParams.delete("pli");
            const clearedQuery = clearedParams.toString();
            router.replace(clearedQuery ? `${pathname}?${clearedQuery}` : pathname);
          }

          // When in docked mode (player is a sidebar alongside a list page), close the
          // player immediately rather than navigating to the next video — the list page
          // handles its own removal animation via the ytr:video-catalog-deleted event.
          if (isDockedDesktop) {
            const params = new URLSearchParams(searchParams.toString());
            params.delete("v");
            params.delete("pl");
            params.delete("pli");
            const query = params.toString();
            router.replace(query ? `${pathname}?${query}` : pathname);
            return;
          }

          if (activePlaylistId) {
            const remainingPlaylistIds = playlistQueueIds.filter((id) => id !== deletingVideoId);
            if (remainingPlaylistIds.length > 0) {
              const deletedIndex = effectivePlaylistIndex ?? playlistQueueIds.findIndex((id) => id === deletingVideoId);
              const nextIndex = Math.max(0, Math.min(deletedIndex, remainingPlaylistIds.length - 1));
              const nextId = remainingPlaylistIds[nextIndex] ?? remainingPlaylistIds[0] ?? null;

              if (nextId && nextId !== deletingVideoId) {
                navigateToVideo(nextId, {
                  clearPlaylist: false,
                  playlistId: activePlaylistId,
                  playlistItemIndex: nextIndex,
                });
                return;
              }
            }
          }

          if (resolvedNextTarget?.videoId && resolvedNextTarget.videoId !== deletingVideoId) {
            navigateToVideo(resolvedNextTarget.videoId, {
              clearPlaylist: resolvedNextTarget.clearPlaylist,
              playlistId: resolvedNextTarget.clearPlaylist ? null : activePlaylistId,
              playlistItemIndex: resolvedNextTarget.playlistItemIndex,
            });
            return;
          }

          const recoveredVideoId = await resolveAutoplayRecoveryTarget();

          if (recoveredVideoId && recoveredVideoId !== deletingVideoId) {
            navigateToVideo(recoveredVideoId, {
              clearPlaylist: true,
              playlistId: null,
              playlistItemIndex: null,
            });
            return;
          }

          const params = new URLSearchParams(searchParams.toString());
          params.delete("v");
          params.delete("pl");
          params.delete("pli");
          const query = params.toString();
          router.replace(query ? `${pathname}?${query}` : pathname);
          router.refresh();
        } catch {
          showUnavailableOverlayMessage("Could not remove this video from the site.");
        } finally {
          setIsAdminDeleting(false);
        }
      }

      function handlePlayerFrameFocusCapture() {
        setShowControls(true);
      }

      function handlePlayerFrameBlurCapture(event: FocusEvent<HTMLDivElement>) {
        const nextFocusedNode = event.relatedTarget;

        if (!(nextFocusedNode instanceof Node) || !event.currentTarget.contains(nextFocusedNode)) {
          if (isPlaying) {
            setShowControls(false);
            setShowShareMenu(false);
          }
        }
      }

      return (
        <>
          {!suppressUnavailablePlaybackSurface ? (
            <div
              ref={playerFrameRef}
              className={playerFrameClassName}
              onMouseEnter={() => setShowControls(true)}
              onMouseLeave={() => {
                if (isPlaying) {
                  setShowControls(false);
                  setShowShareMenu(false);
                }
              }}
              onFocusCapture={handlePlayerFrameFocusCapture}
              onBlurCapture={handlePlayerFrameBlurCapture}
            >
              <div ref={playerElementRef} className="playerMount" />

              {showPlayerLoadingOverlay ? (
                <div className="playerBootLoader" role="status" aria-live="polite" aria-label={showRouteLikeLoadingCopy ? routeLoadingLabel : "Loading video player"}>
                  <div className="playerBootBars" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <p>{showRouteLikeLoadingCopy ? routeLoadingMessage : "connecting to upstream video provider..."}</p>
                  {!showRouteLikeLoadingCopy && showPlayerRefreshHint ? (
                    <div className="playerBootRefreshWrap">
                      <button
                        type="button"
                        className="playerBootRefreshBtn"
                        onClick={handleReloadPlayerIframe}
                        aria-label="Try connecting again"
                        title="Try connecting again"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="23 4 23 10 17 10" />
                          <polyline points="1 20 1 14 7 14" />
                          <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10" />
                          <path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14" />
                        </svg>
                      </button>
                      <span className="playerBootRefreshLabel">Try connecting again</span>
                                  {!isPlayerReady ? (
                                    <div className="overlayBottom" style={{ opacity: 1, visibility: "visible", pointerEvents: "auto" }}>
                                      <div className="overlayProgressWrap">
                                        <input
                                          type="range"
                                          className="overlayProgress"
                                          min={0}
                                          max={1}
                                          value={0}
                                          disabled
                                          aria-label="Progress bar unavailable during load"
                                        />
                                      </div>
                                    </div>
                                  ) : null}

                    </div>
                  ) : null}
                </div>
              ) : null}

              {isPlayerReady && (
                <div className={!hasPlaybackStarted || !isPlaying || showControls ? "playerOverlay playerOverlayVisible" : "playerOverlay"}>
                <div className="overlayTop">
                  {!isFullscreen ? (
                    <div className="overlayTitleRow">
                      <p className="overlayTitle">{displayTitle}</p>
                      {isAdmin ? (
                        <button
                          type="button"
                          className="overlayIconBtn overlayAdminEditBtn"
                          onClick={() => {
                            void handleOpenAdminVideoEdit();
                          }}
                          aria-label="Edit video record"
                          title="Edit video record"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                          </svg>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="shareMenuWrap">
                    {isAdmin ? (
                      <button
                        type="button"
                        className="overlayIconBtn overlayAdminDeleteBtn"
                        onClick={() => {
                          setAdminEditError(null);
                          setAdminEditStatus(null);
                          setShowShareMenu(false);
                          setShowAdminDeleteConfirmModal(true);
                        }}
                        aria-label="Remove video from site"
                        title="Remove video from site"
                        disabled={isAdminDeleting}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14H6L5 6" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                          <path d="M9 6V4h6v2" />
                        </svg>
                      </button>
                    ) : null}
                    {showDockCloseButton ? (
                      <button
                        type="button"
                        className="overlayIconBtn overlayDockCloseBtn"
                        onClick={handleDockClose}
                        aria-label="Close docked video"
                        title="Close video"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="overlayIconBtn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowShareMenu((v) => !v);
                        }}
                        aria-label="Share"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                        </svg>
                      </button>
                    )}
                    {!showDockCloseButton && showShareMenu && (
                      <div className="shareMenu">
                        <button type="button" onClick={handleShareToChat}>
                          {isLoggedIn
                            ? shareToChatState === "sending"
                              ? "Sharing..."
                              : shareToChatState === "sent"
                                ? "Shared to Global Chat"
                                : shareToChatState === "error"
                                  ? "Could not share"
                                  : "Share to Global Chat"
                            : copied
                              ? "Link Copied!"
                              : "Copy Share Link"}
                        </button>
                        <button type="button" onClick={handleShareToSocials}>
                          Share to Socials
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="overlayCenter">
                  {!showPlayerLoadingOverlay && (
                    <button
                      type="button"
                      className="overlayPlayBtn"
                      onClick={handlePlayPause}
                      aria-label={isPlaying ? "Pause" : "Play"}
                    >
                      {isPlaying ? (
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                        </svg>
                      ) : (
                        <svg className="overlayPlayIcon" width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5,3 19,12 5,21" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>

                <div className="overlayBottom">
                  <div className="overlayProgressWrap">
                    {isScrubbing ? (
                      <div
                        className="overlayProgressIndicator"
                        style={{ left: `${progressPercent}%` }}
                        aria-hidden="true"
                      >
                        {elapsedLabel}
                      </div>
                    ) : null}
                    <input
                      type="range"
                      className="overlayProgress"
                      min={0}
                      max={Math.max(1, safeDuration)}
                      step={0.5}
                      value={safeCurrentTime}
                      onChange={handleSeek}
                      onMouseDown={() => setIsScrubbing(true)}
                      onMouseUp={() => setIsScrubbing(false)}
                      onTouchStart={() => setIsScrubbing(true)}
                      onTouchEnd={() => setIsScrubbing(false)}
                      onFocus={() => setIsScrubbing(true)}
                      onBlur={() => setIsScrubbing(false)}
                      aria-label={`Seek position ${elapsedLabel} of ${durationLabel}`}
                    />
                  </div>
                  <div className="overlayVolume">
                    <button
                      type="button"
                      className="overlayIconBtn"
                      onClick={handleMuteToggle}
                      aria-label={isMuted ? "Unmute" : "Mute"}
                    >
                      {isMuted || volume === 0 ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                        </svg>
                      )}
                    </button>
                    <input
                      type="range"
                      className="overlayVolumeSlider"
                      min={0}
                      max={100}
                      value={overlayVolumeValue}
                      onChange={handleVolumeChange}
                      aria-label="Volume"
                    />
                    <div className="overlayTimeMeta" aria-label={`Playback time ${elapsedLabel} of ${durationLabel}`}>
                      <span>{elapsedLabel}</span>
                      <span>/</span>
                      <span>{durationLabel}</span>
                    </div>
                    <button
                      type="button"
                      className="overlayIconBtn overlayFullscreenBtn"
                      onClick={handleFullscreenToggle}
                      aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                    >
                      {isFullscreen ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="8 3 3 3 3 8" /><polyline points="21 8 21 3 16 3" />
                          <polyline points="3 16 3 21 8 21" /><polyline points="16 21 21 21 21 16" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                          <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                </div>
              )}

              {showNowPlayingOverlay ? (
                <div key={`${currentVideo.id}-${overlayInstance}`} className="nowPlayingOverlay nowPlayingOverlayAnimate">
                  <p className="statusLabel">Now playing</p>
                  <strong>{displayTitle}</strong>
                </div>
              ) : null}

            </div>
          ) : null}

          {unavailableOverlayMessage ? (
            <div className="videoUnavailableOverlay" role="alertdialog" aria-modal="true" aria-label="Video unavailable">
              <p className="videoUnavailableOverlayEyebrow">
                {isUpstreamConnectivityOverlay ? "Provider connection timeout" : "Playback issue"}
              </p>
              <strong className="videoUnavailableOverlayTitle">
                {isUpstreamConnectivityOverlay ? "Could not start this track yet" : "This track is unavailable"}
              </strong>
              <p className="videoUnavailableOverlayBody">{unavailableOverlayMessage}</p>
              <div className="videoUnavailableOverlayActions">
                {isUpstreamConnectivityOverlay ? (
                  <button
                    type="button"
                    className="videoUnavailableOverlayRefresh"
                    onClick={handleReloadPlayerIframe}
                  >
                    Retry connection
                  </button>
                ) : null}
                {unavailableOverlayRequiresOk ? (
                  <button
                    type="button"
                    className="videoUnavailableOverlayAcknowledge"
                    onClick={acknowledgeUnavailableOverlay}
                  >
                    Choose another track
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {showEndedChoiceOverlay ? (
            <div
              className="playerEndedChoiceOverlay"
              role="dialog"
              aria-modal="false"
              aria-label="Choose the next video"
            >
              <div
                ref={endedChoiceOverlayRef}
                className="playerEndedChoiceScrollArea"
                onScroll={handleEndedChoiceOverlayScroll}
                aria-busy={endedChoiceLoading}
              >
              <div
                className={endedChoiceGridExiting ? "playerEndedChoiceGrid playerEndedChoiceGridExiting" : "playerEndedChoiceGrid"}
              >
                {endedChoiceLoading && endedChoiceGridVideos.length === 0 ? (
                  <div className="playerEndedChoiceLoadingState" role="status" aria-live="polite" aria-label="Loading more choices">
                    <span className="playerBootBars" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                    </span>
                    <span className="playerEndedChoiceLoadingLabel">Loading choices...</span>
                  </div>
                ) : null}
                {endedChoiceGridVideos.map((video, index) => {
                  const isSeen = isLoggedIn && (seenVideoIds?.has(video.id) ?? false);
                  const isHiding = endedChoiceHidingIds.includes(video.id);
                  const shouldAnimateCard = endedChoiceAnimateCards && !isHiding;

                  return (
                    <EndedChoiceCard
                      key={video.id}
                      video={video}
                      index={index}
                      isSeen={isSeen}
                      isHiding={isHiding}
                      shouldAnimateCard={shouldAnimateCard}
                      isLoggedIn={isLoggedIn}
                      onSelect={handleEndedChoiceSelect}
                      onHide={handleEndedChoiceHide}
                      onMeasure={index === 0 ? measureEndedChoiceCard : undefined}
                    />
                  );
                })}
                {endedChoiceLoading && endedChoiceGridVideos.length > 0 ? (
                  <div className="playerEndedChoiceLoadingState" role="status" aria-live="polite" aria-label="Loading more choices">
                    <span className="playerBootBars" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                    </span>
                    <span className="playerEndedChoiceLoadingLabel">Loading more choices...</span>
                  </div>
                ) : null}
                {shouldShowEndedChoiceEmptyState ? (
                  <div className="playerEndedChoiceEmptyState">
                    No unseen choices right now. Try more choices or watch again.
                  </div>
                ) : null}
              </div>
              </div>
              <div className="playerEndedChoiceActions">
                <button
                  type="button"
                  className="playerEndedChoiceWatchAgain"
                  onClick={handleEndedChoiceWatchAgain}
                >
                  {"<- watch again"}
                </button>
                {isLoggedIn ? (
                  <button
                    type="button"
                    className={`newPageSeenToggle playerEndedChoiceSeenToggle${endedChoiceHideSeen ? " newPageSeenToggleActive" : ""}`}
                    onClick={() => setEndedChoiceHideSeen((value) => !value)}
                    aria-pressed={endedChoiceHideSeen}
                  >
                    {endedChoiceHideSeen ? "Showing unseen only" : "Show unseen only"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {showShareModal ? (
            <div
              className="shareModalBackdrop"
              role="dialog"
              aria-modal="true"
              aria-label="Share this video"
              onClick={() => setShowShareModal(false)}
            >
              <div className="shareModal" onClick={(event) => event.stopPropagation()}>
                <div className="shareModalHeader">
                  <strong>Share This Video</strong>
                  <button
                    type="button"
                    className="overlayIconBtn"
                    onClick={() => setShowShareModal(false)}
                    aria-label="Close share modal"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                <p className="shareModalSubtitle">Choose a platform, or copy the URL to share anywhere.</p>

                <div className="shareModalGrid">
                  {socialShareTargets.map((target) => (
                    <button
                      key={target.id}
                      type="button"
                      className="shareModalTarget"
                      onClick={() => handleShareTargetOpen(target.href)}
                    >
                      {target.label}
                    </button>
                  ))}
                </div>

                <div className="shareModalUrlRow">
                  <label htmlFor="share-modal-url" className="shareUrlLabel">Share URL</label>
                  <input
                    id="share-modal-url"
                    type="text"
                    className="shareUrlInput"
                    readOnly
                    value={shareUrl}
                    onFocus={(event) => event.currentTarget.select()}
                    onClick={(event) => event.currentTarget.select()}
                  />
                  <button type="button" onClick={handleCopyShareUrlForModal}>
                    {shareModalCopied ? "Copied!" : "Copy Link"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {showAdminVideoEditModal ? (
            <div
              className="shareModalBackdrop"
              role="dialog"
              aria-modal="true"
              aria-label="Edit video record"
              onClick={() => {
                if (!isAdminEditSaving) {
                  closeAdminVideoEditModal();
                }
              }}
            >
              <div className="shareModal adminVideoEditModal" onClick={(event) => event.stopPropagation()}>
                <div className="shareModalHeader">
                  <strong>Edit Video Record</strong>
                  <button
                    type="button"
                    className="overlayIconBtn"
                    onClick={closeAdminVideoEditModal}
                    aria-label="Close editor"
                    disabled={isAdminEditSaving}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                {isAdminEditLoading ? <p className="authMessage">Loading video details...</p> : null}
                {adminEditError ? <p className="authMessage">{adminEditError}</p> : null}
                {adminEditStatus ? <p className="authMessage">{adminEditStatus}</p> : null}

                {!isAdminEditLoading ? (
                  <div className="adminVideoEditGrid">
                    <label>
                      <span>Title</span>
                      <input
                        value={adminEditTitle}
                        onChange={(event) => setAdminEditTitle(event.currentTarget.value)}
                        maxLength={255}
                      />
                    </label>
                    <label>
                      <span>Channel title</span>
                      <input
                        value={adminEditChannelTitle}
                        onChange={(event) => setAdminEditChannelTitle(event.currentTarget.value)}
                        maxLength={255}
                      />
                    </label>
                    <label>
                      <span>Parsed artist</span>
                      <input
                        value={adminEditParsedArtist}
                        onChange={(event) => setAdminEditParsedArtist(event.currentTarget.value)}
                        maxLength={255}
                      />
                    </label>
                    <label>
                      <span>Parsed track</span>
                      <input
                        value={adminEditParsedTrack}
                        onChange={(event) => setAdminEditParsedTrack(event.currentTarget.value)}
                        maxLength={255}
                      />
                    </label>
                    <label>
                      <span>Video type</span>
                      <input
                        value={adminEditParsedVideoType}
                        onChange={(event) => setAdminEditParsedVideoType(event.currentTarget.value)}
                        maxLength={50}
                      />
                    </label>
                    <label>
                      <span>Parse confidence (0-1)</span>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        value={adminEditParseConfidence}
                        onChange={(event) => setAdminEditParseConfidence(event.currentTarget.value)}
                      />
                    </label>
                    <label className="adminVideoEditFieldFull">
                      <span>Description</span>
                      <textarea
                        value={adminEditDescription}
                        onChange={(event) => setAdminEditDescription(event.currentTarget.value)}
                        rows={4}
                      />
                    </label>
                  </div>
                ) : null}

                <div className="adminVideoEditActions">
                  <button
                    type="button"
                    className="adminVideoEditButton adminVideoEditButtonSecondary"
                    onClick={closeAdminVideoEditModal}
                    disabled={isAdminEditSaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="adminVideoEditButton adminVideoEditButtonPrimary"
                    onClick={() => {
                      void handleSaveAdminVideoEdit();
                    }}
                    disabled={isAdminEditSaving || isAdminEditLoading || !adminEditVideoRowId}
                  >
                    {isAdminEditSaving ? "Saving..." : "Save changes"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {showAdminDeleteConfirmModal && typeof document !== "undefined"
            ? createPortal(
                <div
                  className="shareModalBackdrop"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Confirm permanent video deletion"
                  onClick={() => {
                    if (!isAdminDeleting) {
                      setShowAdminDeleteConfirmModal(false);
                    }
                  }}
                >
                  <div className="shareModal adminVideoEditModal" onClick={(event) => event.stopPropagation()}>
                    <div className="shareModalHeader">
                      <strong>Delete Video Permanently</strong>
                    </div>

                    <p className="authMessage">
                      This will remove this video from all related tables and cannot be undone.
                    </p>
                    <p className="authMessage">{displayTitle}</p>
                    {adminEditError ? <p className="authMessage">{adminEditError}</p> : null}

                    <div className="adminVideoEditActions">
                      <button
                        type="button"
                        className="adminVideoEditButton adminVideoEditButtonSecondary"
                        onClick={() => setShowAdminDeleteConfirmModal(false)}
                        disabled={isAdminDeleting}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="adminVideoEditButton adminVideoEditButtonPrimary"
                        onClick={() => {
                          void handleAdminDeleteCurrentVideo();
                        }}
                        disabled={isAdminDeleting}
                      >
                        {isAdminDeleting ? "Deleting..." : "Delete permanently"}
                      </button>
                    </div>
                  </div>
                </div>,
                document.body,
              )
            : null}

          {!suppressUnavailablePlaybackSurface ? (
            <div
              className={[
                footerActionsBlocked ? "primaryActions primaryActionsUnavailable" : "primaryActions",
                showDockCloseButton && isAdmin ? "primaryActionsDockedAdmin" : "",
              ].filter(Boolean).join(" ")}
              aria-disabled={footerActionsBlocked ? true : undefined}
            >
            <div className="primaryActionsMainRow">
            {!(showDockCloseButton && isAdmin) ? (
              <div className="shareUrlField">
                <label htmlFor="share-url" className="shareUrlLabel">SHARE URL</label>
                <div className="shareUrlInputWrap">
                  <input
                    id="share-url"
                    type="text"
                    className="shareUrlInput"
                    size={Math.min(Math.max(shareUrl.length, 24), 48)}
                    style={{ width: `calc(${Math.min(Math.max(shareUrl.length, 24), 48)}ch + 53px)` }}
                    readOnly
                    value={shareUrl}
                    onFocus={(event) => event.currentTarget.select()}
                    onClick={(event) => event.currentTarget.select()}
                    aria-label="Share URL"
                  />
                  <button
                    type="button"
                    className="shareUrlCopyButton"
                    onClick={() => {
                      void handleCopyShareLink();
                    }}
                    disabled={footerActionsBlocked}
                    aria-label={copied ? "Share URL copied" : "Copy share URL"}
                    title={copied ? "Copied" : "Copy share URL"}
                  >
                    <span
                      className="shareUrlCopyIcon"
                      aria-hidden="true"
                      dangerouslySetInnerHTML={{ __html: "&#128203;" }}
                    />
                  </button>
                </div>
              </div>
            ) : null}
            {isLoggedIn && (
              <div className="primaryActionIconButtonWrap primaryActionFavouriteWrap">
                {favouriteSaveState === "saved" && (
                  <div className="favouriteSavedToast" role="status" aria-live="polite">Favourite Saved!</div>
                )}
                {favouriteSaveState === "error" && (
                  <div className="favouriteSavedToast favouriteSavedToastError" role="status" aria-live="polite">Could not save</div>
                )}
                <button
                  type="button"
                  className="primaryActionIconButton"
                  aria-label="Add to favourites"
                  title="Add to favourites"
                  disabled={favouriteSaveState === "saving" || footerActionsBlocked}
                  onClick={handleAddFavourite}
                >
                  <span className="navFavouritesGlyph" aria-hidden="true">❤️</span>
                </button>
              </div>
            )}
            {isLoggedIn && !showEndedChoiceOverlay ? (
              <div className="primaryActionIconButtonWrap primaryActionPlaylistWrap" ref={footerPlaylistMenuRef}>
                <button
                  type="button"
                  className="primaryActionIconButton primaryActionPlaylistButton"
                  aria-label="Add to playlist"
                  title="Add to playlist"
                  onClick={() => {
                    void handleFooterPlaylistButtonClick();
                  }}
                  disabled={footerPlaylistAddState === "saving" || footerActionsBlocked}
                >
                  <span className="primaryActionPlaylistGlyph" aria-hidden="true">+</span>
                </button>
                {showFooterPlaylistMenu ? (
                  <div className="primaryActionPlaylistMenu" role="menu" aria-label="Choose playlist">
                    <div className="playlistQuickAddMenuHeader">
                      <strong>Add to...</strong>
                    </div>
                    {activePlaylistId ? (
                      <button
                        type="button"
                        className="primaryActionPlaylistMenuAction"
                        onClick={() => {
                          void handleFooterPlaylistSelect(activePlaylistId);
                        }}
                        disabled={footerPlaylistAddState === "saving" || footerActionsBlocked}
                      >
                        Current Playlist
                      </button>
                    ) : null}
                    {footerSamePlaylistId ? (
                      <button
                        type="button"
                        className="primaryActionPlaylistMenuAction"
                        onClick={() => {
                          void handleFooterPlaylistSelect(footerSamePlaylistId);
                        }}
                        disabled={footerPlaylistAddState === "saving" || footerActionsBlocked}
                      >
                        The same playlist
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="primaryActionPlaylistMenuAction"
                      onClick={() => {
                        void handleFooterCreatePlaylistNoOpen();
                      }}
                      disabled={footerPlaylistAddState === "saving" || footerActionsBlocked}
                    >
                      New playlist
                    </button>
                    <button
                      type="button"
                      className="primaryActionPlaylistMenuAction"
                      onClick={() => {
                        void handleFooterCreatePlaylist();
                      }}
                      disabled={footerPlaylistAddState === "saving" || footerActionsBlocked}
                    >
                      New playlist then open
                    </button>
                    <button
                      type="button"
                      className="primaryActionPlaylistMenuAction"
                      onClick={() => {
                        setFooterOpenAfterSelect(false);
                        setFooterShowExistingList(true);
                        void loadFooterPlaylistMenu();
                      }}
                      disabled={footerPlaylistAddState === "saving" || footerActionsBlocked}
                    >
                      Existing playlist
                    </button>
                    <button
                      type="button"
                      className="primaryActionPlaylistMenuAction"
                      onClick={() => {
                        setFooterOpenAfterSelect(true);
                        setFooterShowExistingList(true);
                        void loadFooterPlaylistMenu();
                      }}
                      disabled={footerPlaylistAddState === "saving" || footerActionsBlocked}
                    >
                      Existing playlist then open
                    </button>
                    {footerShowExistingList ? (
                      footerPlaylistMenuLoading ? (
                        <p className="primaryActionPlaylistMenuStatus">Loading playlists...</p>
                      ) : footerSelectablePlaylists.length === 0 ? (
                        <p className="primaryActionPlaylistMenuStatus">No playlists yet</p>
                      ) : (
                        <div className="primaryActionPlaylistMenuList">
                          {footerSelectablePlaylists.map((playlist) => (
                            <button
                              key={playlist.id}
                              type="button"
                              className="primaryActionPlaylistMenuAction"
                              onClick={() => {
                                void handleFooterPlaylistSelect(playlist.id);
                              }}
                              disabled={footerPlaylistAddState === "saving" || footerActionsBlocked}
                            >
                              {playlist.name}
                            </button>
                          ))}
                        </div>
                      )
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              className="primaryActionNavIconButton"
              onClick={handlePrevious}
              disabled={!hasPreviousTrack || footerActionsBlocked}
              aria-label="Previous"
              title="Previous"
            >
              <span className="primaryNavGlyph" aria-hidden="true">⇤</span>
            </button>
            <button
              type="button"
              className="primaryActionNavIconButton"
              onClick={handleNext}
              disabled={footerActionsBlocked}
              aria-label="Next"
              title="Next"
            >
              <span className="primaryNavGlyph" aria-hidden="true">⇥</span>
            </button>
            {!showDockCloseButton && hasArtistName ? (
              <ArtistWikiLink
                artistName={displayChannelTitle}
                videoId={currentVideo.id}
                asButton
                className="primaryActionToggleButton primaryActionWikiButton"
                title={`Open ${displayChannelTitle} wiki`}
                disabled={footerActionsBlocked}
              >
                <span className="primaryActionWikiLabel">wiki</span>
              </ArtistWikiLink>
            ) : null}
            {!showDockCloseButton ? (
              <button
                type="button"
                className="primaryActionToggleButton primaryActionWikiButton"
                onClick={handleOpenLyrics}
                disabled={lyricsButtonDisabled}
                aria-label={lyricsUnavailableForCurrentVideo ? "Lyrics unavailable for this track" : "Open lyrics"}
                title={lyricsUnavailableForCurrentVideo ? "No lyrics available for this track" : "Open lyrics"}
              >
                <span className="primaryActionWikiLabel">lyrics</span>
              </button>
            ) : null}
            <button
              type="button"
              className={autoplayEnabled ? "primaryActionToggleButton primaryActionAutoplayButton primaryActionToggleButtonActive" : "primaryActionToggleButton primaryActionAutoplayButton"}
              onClick={handleToggleAutoplay}
              disabled={footerActionsBlocked}
              aria-label={autoplayEnabled ? "Disable autoplay" : "Enable autoplay"}
              title={autoplayEnabled ? "Disable autoplay" : "Enable autoplay"}
            >
              <span className="primaryActionGlyph" aria-hidden="true">⇮</span>
              <span>{autoplayEnabled ? "On" : "Off"}</span>
            </button>
            {isLoggedIn ? (
              <button
                type="button"
                className="primaryActionToggleButton primaryActionToggleButtonTrash"
                onClick={() => {
                  void handleHideCurrentVideo();
                }}
                disabled={hideCurrentVideoState === "saving" || footerActionsBlocked}
                aria-label="Hide this video and skip"
                title={hideCurrentVideoState === "saving" ? "Hiding..." : "No That SUCKS!"}
              >
                <span className="primaryActionThumbsDownGlyph" aria-hidden="true">👎</span>
                <span className="primaryActionTrashLabel">No That SUCKS!</span>
              </button>
            ) : null}
            </div>
            {showDockCloseButton && isAdmin ? (
              <div className="dockedAdminShareUrlRow">
                <input
                  type="text"
                  className="dockedAdminShareUrlInput"
                  value={shareUrl}
                  readOnly
                  aria-label="Share URL"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button
                  type="button"
                  className="dockedAdminShareUrlCopyButton"
                  onClick={() => {
                    void handleCopyShareLink();
                  }}
                  disabled={footerActionsBlocked}
                  aria-label="Copy share URL"
                  title="Copy share URL"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            ) : null}
            </div>
          ) : null}
        </>
      );
    }
