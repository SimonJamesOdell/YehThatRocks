"use client";

import { ChangeEvent, startTransition, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type UIEvent } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { VideoRecord } from "@/lib/catalog";
import { buildSharedVideoMessage } from "@/lib/chat-shared-video";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { buildCanonicalShareUrl } from "@/lib/share-metadata";
import { HideVideoConfirmModal } from "@/components/hide-video-confirm-modal";
import { RemoveFavouriteConfirmModal } from "@/components/remove-favourite-confirm-modal";
import { useNextTrackDecision } from "@/components/use-next-track-decision";
import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";
import { EVENT_NAMES, dispatchAppEvent, listenToAppEvent, TEMP_QUEUE_DEQUEUE_EVENT, VIDEO_ENDED_EVENT } from "@/lib/events-contract";
import { mutateHiddenVideo } from "@/lib/hidden-video-client-service";
import { addPlaylistItemClient, createPlaylistClient, listPlaylistsClient } from "@/lib/playlist-client-service";
import { applyRuntimeBootstrapPatches } from "@/lib/runtime-bootstrap";
import { useSeenTogglePreference } from "@/components/use-seen-toggle-preference";
import { EndedChoiceCard } from "@/components/player-experience-ended-choice-card";
import {
  buildRouteAutoplayPlaylistName,
  buildRouteAutoplayTelemetryMode,
  resolveRouteAutoplaySource,
  type NextChoiceVideo,
  type RouteAutoplaySource,
} from "@/components/player-experience-autoplay-utils";
import {
  isInteractivePlaybackBlockReason,
  isUnavailableVerificationReason,
  resolveVerifiedPlaybackFailurePresentation,
  type ReportUnavailableResult,
} from "@/components/player-experience-playback-failure-utils";

type PlayerExperienceProps = {
  currentVideo: VideoRecord;
  queue: VideoRecord[];
  temporaryQueue?: VideoRecord[];
  isLoggedIn: boolean;
  isAdmin?: boolean;
  isDockedDesktop?: boolean;
  suppressAuthWall?: boolean;
  seenVideoIds?: Set<string>;
  onHideVideo?: (track: VideoRecord) => void | Promise<void>;
  onAddVideoToPlaylist?: (track: VideoRecord) => void | Promise<void>;
  onDockHideRequest?: () => void;
  onAuthRequired?: () => void;
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
const ROUTE_AUTOPLAY_QUEUE_SYNC_EVENT = "ytr:new-route-queue-sync";
const RANDOM_NEXT_RECENT_EXCLUSION = 18;
const UNAVAILABLE_PLAYER_CODES = new Set([5, 100, 101, 150]);
const PLAYER_DEBUG_ENABLED = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEBUG_PLAYER === "1";
const FLOW_DEBUG_ENABLED = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEBUG_FLOW === "1";
const UNAVAILABLE_OVERLAY_MESSAGE = "Sorry, this video is no longer available. Please choose another track.";
const BROKEN_UPSTREAM_OVERLAY_MESSAGE = "This video is no longer available on YouTube and has been removed from the catalog.";
const COPYRIGHT_CLAIM_OVERLAY_MESSAGE = "This video is no longer available due to a copyright claim on YouTube.";
const REMOVED_PRIVATE_OVERLAY_MESSAGE = "This video is unavailable on YouTube because it was removed, deleted, or made private.";
const BROKEN_UPSTREAM_AUTOADVANCE_MS = 6000;
const UPSTREAM_CONNECTIVITY_OVERLAY_MESSAGE = "We could not connect to the upstream video provider for this track. This is not a YehThatRocks failure. Please try the refresh button and if that does not work, choose another track.";
const DELETED_TRACK_OVERLAY_MESSAGE = "This track was removed from YehThatRocks.";
const EARLY_PLAYBACK_VERIFICATION_MS = 700;
const STUCK_PLAYBACK_CHECK_MS = 2200;
const STUCK_PLAYBACK_MAX_RETRIES = 3;
const STUCK_PLAYBACK_RETRY_DELAYS_MS = [350, 900, 1600] as const;
const MID_PLAYBACK_BUFFERING_CHECK_MS = 1000;
const MID_PLAYBACK_BUFFERING_THRESHOLD_MS = 8000;
const PLAYBACK_STALL_DIRECT_IFRAME_THRESHOLD_MS = 4500;
const PLAYBACK_STALL_PROGRESS_EPSILON_SECONDS = 0.2;
const PLAYER_LOAD_REFRESH_HINT_DELAY_MS = 2000;
const PLAYER_AUTO_RECONNECT_DELAY_MS = 2000;
const MANUAL_TRANSITION_MASK_TIMEOUT_MS = 8000;
const LAST_PLAYLIST_ID_KEY = "ytr:last-playlist-id";
const ADMIN_SESSION_REVALIDATE_INTERVAL_MS = 30_000;
const maxEndedChoiceVideos = 12;
const ENDED_CHOICE_BATCH_SIZE = maxEndedChoiceVideos;
const ENDED_CHOICE_INITIAL_PREFETCH_COUNT = 24;
const ENDED_CHOICE_SCROLL_RUNWAY_COUNT = 24;
const ENDED_CHOICE_PREFETCH_BEFORE_END_SECONDS = 3;
const YOUTUBE_END_SCREEN_COVER_SECONDS = 0;
const ENDED_CHOICE_HIDE_SEEN_TOGGLE_KEY = "ytr-toggle-hide-seen-ended-choice";

applyRuntimeBootstrapPatches({ suppressWebShareWarning: true });

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

// One-way flag: set the first time a genuine user input event fires in this
// browser session. Subsequent player instantiations (video changes) bypass the
// interaction gate because the same session has already proven itself human.
let didPageHaveUserInteraction = false;

export function PlayerExperience({
  currentVideo,
  queue,
  temporaryQueue = [],
  isLoggedIn,
  isAdmin: initialIsAdmin = false,
  isDockedDesktop = false,
  suppressAuthWall = false,
  seenVideoIds,
  onHideVideo,
  onAddVideoToPlaylist,
  onDockHideRequest,
  onAuthRequired,
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
  const unavailableAutoCountdownIntervalRef = useRef<number | null>(null);
  const playerLoadRefreshHintTimeoutRef = useRef<number | null>(null);
  const playerAutoReconnectTimeoutRef = useRef<number | null>(null);
  const manualTransitionMaskTimeoutRef = useRef<number | null>(null);
  const playlistDropAnimationTimeoutRef = useRef<number | null>(null);
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
  const [isCurrentVideoFavourited, setIsCurrentVideoFavourited] = useState(Number(currentVideo.favourited ?? 0) > 0);
  const [removeFavouriteState, setRemoveFavouriteState] = useState<"idle" | "removing">("idle");
  const [showRemoveFavouriteConfirm, setShowRemoveFavouriteConfirm] = useState(false);
  const [playlistDropAnimation, setPlaylistDropAnimation] = useState<{
    key: number;
    thumbnailUrl: string;
    fromX: number;
    fromY: number;
    deltaX: number;
    deltaY: number;
    fromWidth: number;
    fromHeight: number;
    scale: number;
  } | null>(null);
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
  const [unavailableOverlayKind, setUnavailableOverlayKind] = useState<"playback" | "deleted">("playback");
  const [unavailableOverlayRequiresOk, setUnavailableOverlayRequiresOk] = useState(false);
  const [unavailableAutoAdvanceMs, setUnavailableAutoAdvanceMs] = useState<number | null>(null);
  const [unavailableAutoAdvanceSeconds, setUnavailableAutoAdvanceSeconds] = useState<number | null>(null);
  const [showEndedChoiceOverlay, setShowEndedChoiceOverlay] = useState(false);
  const [showEndScreenCover, setShowEndScreenCover] = useState(false);
  const [endedChoiceFromUnavailable, setEndedChoiceFromUnavailable] = useState(false);
  const [endedChoiceReshuffleKey, setEndedChoiceReshuffleKey] = useState(0);
  const [endedChoiceGridExiting, setEndedChoiceGridExiting] = useState(false);
  const [endedChoiceHidingIds, setEndedChoiceHidingIds] = useState<string[]>([]);
  const [endedChoiceDismissedIds, setEndedChoiceDismissedIds] = useState<string[]>([]);
  const [endedChoiceHideConfirmVideo, setEndedChoiceHideConfirmVideo] = useState<VideoRecord | null>(null);
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
  const [allowDirectIframeInteraction, setAllowDirectIframeInteraction] = useState(false);
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
    const isScrubbingRef = useRef(isScrubbing);
    const allowDirectIframeInteractionRef = useRef(allowDirectIframeInteraction);
    const playbackStallStartedAtRef = useRef<number | null>(null);
    const playbackStallLastTimeRef = useRef<number | null>(null);
    const playbackStallLastObservedAtRef = useRef<number | null>(null);
    const nowPlayingShownForVideoRef = useRef<string | null>(null);
    const nowPlayingLastVideoIdRef = useRef<string | null>(null);
    const nowPlayingLastTriggeredAtRef = useRef<number>(0);
    const reportedUnavailableVideoIdRef = useRef<string | null>(null);
    const reportedUnavailableVerificationReasonRef = useRef<string | null>(null);
    const autoplaySuppressedVideoIdRef = useRef<string | null>(null);
    const autoplayRouteTransitionRef = useRef(false);
    const pendingAutoAdvanceVideoIdRef = useRef<string | null>(null);
    const autoplayRecoveryRequestIdRef = useRef(0);
    const playAttemptedAtRef = useRef<number | null>(null);
    const stuckPlaybackRetryCountRef = useRef(0);
    const stuckPlaybackRetryTimeoutRef = useRef<number | null>(null);
    const stuckPlaybackWatchdogTimeoutRef = useRef<number | null>(null);
    const earlyPlaybackVerificationTimeoutRef = useRef<number | null>(null);
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
  const [isAdminSessionActive, setIsAdminSessionActive] = useState(initialIsAdmin);
  const isAdmin = isLoggedIn && isAdminSessionActive;
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

  useEffect(() => {
    setIsAdminSessionActive(initialIsAdmin);
  }, [initialIsAdmin]);

  const revalidateAdminSession = useCallback(async () => {
    if (!isLoggedIn) {
      setIsAdminSessionActive(false);
      return;
    }

    try {
      const response = await fetchWithAuthRetry("/api/admin/dashboard", {
        method: "GET",
        cache: "no-store",
      });

      if (response.ok) {
        setIsAdminSessionActive(true);
        return;
      }

      if (response.status === 401 || response.status === 403) {
        setIsAdminSessionActive(false);
      }
    } catch {
      // Keep current capability state on transient network failures.
    }
  }, [isLoggedIn]);

  useEffect(() => {
    void revalidateAdminSession();
  }, [revalidateAdminSession]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleFocus = () => {
      void revalidateAdminSession();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void revalidateAdminSession();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void revalidateAdminSession();
      }
    }, ADMIN_SESSION_REVALIDATE_INTERVAL_MS);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [revalidateAdminSession]);
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
  const endedChoicePostPrimeQueuedRef = useRef(false);
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
  isScrubbingRef.current = isScrubbing;
  allowDirectIframeInteractionRef.current = allowDirectIframeInteraction;
  if (volume > 0) {
    lastNonZeroVolumeRef.current = volume;
  }
  activePlaylistIdRef.current = activePlaylistId;
  hasPlaybackStartedRef.current = hasPlaybackStarted;

  useEffect(() => {
    currentVideoRef.current = currentVideo;
    setIsCurrentVideoFavourited(Number(currentVideo.favourited ?? 0) > 0);
    setRemoveFavouriteState("idle");
    setShowRemoveFavouriteConfirm(false);
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
    endedChoicePostPrimeQueuedRef.current = false;
  }, [currentVideo]);

  useEffect(() => {
    return () => {
      if (playlistDropAnimationTimeoutRef.current !== null) {
        window.clearTimeout(playlistDropAnimationTimeoutRef.current);
        playlistDropAnimationTimeoutRef.current = null;
      }
    };
  }, []);

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

  const extractVideoIds = useCallback((videos: VideoRecord[] | undefined) => (
    Array.isArray(videos)
      ? videos.map((video) => video?.id).filter((id): id is string => Boolean(id))
      : []
  ), []);

  const fetchHiddenVideoIdSet = useCallback(async () => {
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
  }, [fetchWithAuthRetry, isLoggedIn]);

  const fetchAutoplaySourceVideoIds = useCallback(async (source: RouteAutoplaySource) => {
    if (source.type === "new") {
      const response = await fetch(`/api/videos/newest?skip=0&take=${NEW_AUTOPLAY_PLAYLIST_SIZE}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        return [] as string[];
      }

      const payload = (await response.json().catch(() => null)) as { videos?: VideoRecord[] } | null;
      return extractVideoIds(payload?.videos);
    }

    if (source.type === "top100") {
      const response = await fetch(`/api/videos/top?count=${NEW_AUTOPLAY_PLAYLIST_SIZE}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        return [] as string[];
      }

      const payload = (await response.json().catch(() => null)) as { videos?: VideoRecord[] } | null;
      return extractVideoIds(payload?.videos);
    }

    if (source.type === "favourites") {
      const favouritesResponse = await fetchWithAuthRetry("/api/favourites", {
        cache: "no-store",
      });

      if (!favouritesResponse.ok) {
        return [] as string[];
      }

      const payload = (await favouritesResponse.json().catch(() => null)) as { favourites?: VideoRecord[] } | null;
      return Array.isArray(payload?.favourites)
        ? payload.favourites.map((video) => video?.id).filter((id): id is string => Boolean(id))
        : [];
    }

    if (source.type === "category") {
      const response = await fetch(
        `/api/categories/${encodeURIComponent(source.slug)}?limit=96&offset=0`,
        {
          cache: "no-store",
        },
      );

      if (!response.ok) {
        return [] as string[];
      }

      const payload = (await response.json().catch(() => null)) as { videos?: VideoRecord[] } | null;
      return extractVideoIds(payload?.videos);
    }

    const response = await fetch(`/api/artists/${encodeURIComponent(source.slug)}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return [] as string[];
    }

    const payload = (await response.json().catch(() => null)) as { videos?: VideoRecord[] } | null;
    return extractVideoIds(payload?.videos);
  }, [extractVideoIds, fetchWithAuthRetry]);

  const buildRouteAutoplayPlaylist = useCallback(async (source: RouteAutoplaySource) => {
    if (!isLoggedIn) {
      return { playlistId: null as string | null, firstVideoId: null as string | null };
    }

    try {
      const [rawVideoIds, hiddenSet] = await Promise.all([
        fetchAutoplaySourceVideoIds(source),
        fetchHiddenVideoIdSet(),
      ]);

      const filteredVideoIds = Array.from(new Set(rawVideoIds.filter((videoId) => !hiddenSet.has(videoId)))).slice(
        0,
        NEW_AUTOPLAY_PLAYLIST_SIZE,
      );
      const firstVideoId = filteredVideoIds[0] ?? null;

      if (!firstVideoId) {
        return { playlistId: null as string | null, firstVideoId: null as string | null };
      }

      const createResponse = await createPlaylistClient(
        {
          name: buildRouteAutoplayPlaylistName(source),
          videoIds: filteredVideoIds,
        },
        { telemetryContext: { component: "player-experience-core", mode: buildRouteAutoplayTelemetryMode(source) } },
      );

      if (!createResponse.ok) {
        return { playlistId: null as string | null, firstVideoId };
      }

      const playlistPayload = createResponse.data as { id?: string };
      const playlistId = typeof playlistPayload?.id === "string" ? playlistPayload.id : null;

      if (playlistId) {
        dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);
      }

      return {
        playlistId,
        firstVideoId,
      };
    } catch {
      return { playlistId: null as string | null, firstVideoId: null as string | null };
    }
  }, [fetchAutoplaySourceVideoIds, fetchHiddenVideoIdSet, isLoggedIn]);

  useEffect(() => {
    if (!isDockedDesktop || Boolean(activePlaylistId)) {
      setRouteAutoplayQueueIds([]);
      return;
    }

    const autoplaySource = resolveRouteAutoplaySource(pathname);

    if (!autoplaySource) {
      setRouteAutoplayQueueIds([]);
      return;
    }

    let cancelled = false;
    const routeAutoplaySource = autoplaySource;
    let receivedSyncedQueue = false;

    const handleRouteQueueSync = (event: Event) => {
      if (routeAutoplaySource.type !== "new") {
        return;
      }

      const detail = (event as CustomEvent<{ source?: string; videoIds?: string[] }>).detail;
      if (detail?.source !== "new" || !Array.isArray(detail.videoIds)) {
        return;
      }

      receivedSyncedQueue = true;
      setRouteAutoplayQueueIds(Array.from(new Set(detail.videoIds.filter((videoId): videoId is string => Boolean(videoId)))));
    };

    if (typeof window !== "undefined" && routeAutoplaySource.type === "new") {
      window.addEventListener(ROUTE_AUTOPLAY_QUEUE_SYNC_EVENT, handleRouteQueueSync as EventListener);
    }

    async function loadRouteAutoplayQueue() {
      try {
        const [hiddenSet, rawIds] = await Promise.all([
          fetchHiddenVideoIdSet(),
          fetchAutoplaySourceVideoIds(routeAutoplaySource),
        ]);

        const dedupedVisibleIds = Array.from(new Set(rawIds.filter((videoId) => !hiddenSet.has(videoId))));

        if (!cancelled && !receivedSyncedQueue) {
          setRouteAutoplayQueueIds(dedupedVisibleIds);
        }
      } catch {
        if (!cancelled && !receivedSyncedQueue) {
          setRouteAutoplayQueueIds([]);
        }
      }
    }

    void loadRouteAutoplayQueue();

    return () => {
      cancelled = true;
      if (typeof window !== "undefined" && routeAutoplaySource.type === "new") {
        window.removeEventListener(ROUTE_AUTOPLAY_QUEUE_SYNC_EVENT, handleRouteQueueSync as EventListener);
      }
    };
  }, [activePlaylistId, fetchAutoplaySourceVideoIds, fetchHiddenVideoIdSet, isDockedDesktop, pathname]);

  useEffect(() => {
    const shouldHydrateNonDockedNewQueue =
      !isDockedDesktop &&
      pathname === "/new" &&
      !activePlaylistId &&
      autoplayEnabled;

    if (!shouldHydrateNonDockedNewQueue) {
      return;
    }

    let cancelled = false;
    let receivedSyncedQueue = false;

    const handleRouteQueueSync = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: string; videoIds?: string[] }>).detail;
      if (detail?.source !== "new" || !Array.isArray(detail.videoIds)) {
        return;
      }

      receivedSyncedQueue = true;
      setRouteAutoplayQueueIds(Array.from(new Set(detail.videoIds.filter((videoId): videoId is string => Boolean(videoId)))));
    };

    if (typeof window !== "undefined") {
      window.addEventListener(ROUTE_AUTOPLAY_QUEUE_SYNC_EVENT, handleRouteQueueSync as EventListener);
    }

    async function loadRouteAutoplayQueue() {
      try {
        const [hiddenSet, rawIds] = await Promise.all([
          fetchHiddenVideoIdSet(),
          fetchAutoplaySourceVideoIds({ type: "new" }),
        ]);

        const dedupedVisibleIds = Array.from(new Set(rawIds.filter((videoId) => !hiddenSet.has(videoId))));

        if (!cancelled && !receivedSyncedQueue) {
          setRouteAutoplayQueueIds(dedupedVisibleIds);
        }
      } catch {
        if (!cancelled && !receivedSyncedQueue) {
          setRouteAutoplayQueueIds([]);
        }
      }
    }

    void loadRouteAutoplayQueue();

    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener(ROUTE_AUTOPLAY_QUEUE_SYNC_EVENT, handleRouteQueueSync as EventListener);
      }
    };
  }, [activePlaylistId, autoplayEnabled, fetchAutoplaySourceVideoIds, fetchHiddenVideoIdSet, isDockedDesktop, pathname]);

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

  const { resolvePlaylistStepTarget, resolveNextTarget, resolvedNextTarget } = useNextTrackDecision({
    activePlaylistId,
    hasActivePlaylistContext,
    playlistQueueIds,
    effectivePlaylistIndex,
    temporaryQueue,
    currentVideoId: currentVideo.id,
    isDockedDesktop,
    shouldUseRouteQueueRegardlessOfDocked: autoplayEnabled && pathname === "/new",
    routeAutoplayQueueIds,
    getRandomWatchNextId,
  });

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
    const offset = (endedChoiceReshuffleKey * ENDED_CHOICE_BATCH_SIZE) % Math.max(all.length, 1);
    return [...all.slice(offset), ...all.slice(0, offset)];
  }, [queue, topFallbackVideos, currentVideo.id, endedChoiceReshuffleKey, endedChoiceDismissedIds]);

  const endedChoiceVideos = useMemo(() => {
    const deduped = new Map<string, NextChoiceVideo>();

    for (const video of [...endedChoiceSeedVideos.slice(0, ENDED_CHOICE_BATCH_SIZE), ...endedChoiceRemoteVideos]) {
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
  const isDeletedConfirmationOverlay = unavailableOverlayKind === "deleted";
  const isUpstreamConnectivityOverlay = unavailableOverlayMessage === UPSTREAM_CONNECTIVITY_OVERLAY_MESSAGE;
  const isBrokenUpstreamOverlay = unavailableOverlayMessage === BROKEN_UPSTREAM_OVERLAY_MESSAGE;
  const isCopyrightClaimOverlay = unavailableOverlayMessage === COPYRIGHT_CLAIM_OVERLAY_MESSAGE;
  const isRemovedOrPrivateOverlay = unavailableOverlayMessage === REMOVED_PRIVATE_OVERLAY_MESSAGE;
  const isAutoAdvanceUnavailableOverlay = unavailableAutoAdvanceMs !== null;
  const currentTrackYouTubeUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(currentVideo.id)}`;
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
  const isDockedNewRoute = showDockCloseButton && pathname === "/new";
  const hasActivePlayback = isPlaying || safeCurrentTime > 0;
  const showRouteLikeLoadingCopy = isRouteResolving || isManualTransitionMaskVisible;
  const showPlayerLoadingOverlay = isLoggedIn && (
    isManualTransitionMaskVisible
      || ((!isPlayerReady || isRouteResolving) && !hasActivePlayback)
  );
  const playerFrameClassName = [
    "playerFrame",
    isPlayerReady ? "playerFrameLoaded" : "",
    showPlayerLoadingOverlay ? "playerFrameLoading" : "",
    allowDirectIframeInteraction ? "playerFramePolicyBlocked" : "",
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

    const unsubscribe = listenToAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, handlePlaylistsUpdated);

    return () => {
      unsubscribe();
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

    if (unavailableAutoCountdownIntervalRef.current) {
      window.clearInterval(unavailableAutoCountdownIntervalRef.current);
      unavailableAutoCountdownIntervalRef.current = null;
    }

    unavailableOverlayTimeoutRef.current = null;
    setUnavailableOverlayMessage(null);
    setUnavailableOverlayKind("playback");
    setUnavailableOverlayRequiresOk(false);
    setUnavailableAutoAdvanceMs(null);
    setUnavailableAutoAdvanceSeconds(null);
  }

  function acknowledgeDeletedOverlay() {
    clearUnavailableOverlayMessage();
    setEndedChoiceFromUnavailable(false);
    triggerEndOfVideoAction({ forceAutoplayAdvance: true });
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

  function showUnavailableOverlayMessage(
    message?: string | null,
    options?: { requiresOk?: boolean; autoAdvanceWhenAutoplay?: boolean; countdownMs?: number },
  ) {
    clearUnavailableOverlayMessage();
    clearStuckPlaybackRetryTimer();
    clearStuckPlaybackWatchdogTimer();
    clearMidPlaybackBufferingCheck();
    clearMidPlaybackBufferingCheck();

    const requiresOk = options?.requiresOk ?? !autoplayEnabledRef.current;
    setUnavailableOverlayKind("playback");
    setUnavailableOverlayMessage(message?.trim() || UNAVAILABLE_OVERLAY_MESSAGE);
    setShowEndedChoiceOverlay(false);
    setShowEndScreenCover(false);
    setUnavailableOverlayRequiresOk(requiresOk);

    if (!requiresOk && options?.autoAdvanceWhenAutoplay) {
      const advanceMs = options.countdownMs ?? 5000;
      const deadline = Date.now() + advanceMs;
      setUnavailableAutoAdvanceMs(advanceMs);
      setUnavailableAutoAdvanceSeconds(Math.max(1, Math.ceil(advanceMs / 1000)));

      unavailableAutoCountdownIntervalRef.current = window.setInterval(() => {
        const remainingMs = Math.max(0, deadline - Date.now());
        const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
        setUnavailableAutoAdvanceSeconds(remainingSeconds);

        if (remainingMs <= 0 && unavailableAutoCountdownIntervalRef.current) {
          window.clearInterval(unavailableAutoCountdownIntervalRef.current);
          unavailableAutoCountdownIntervalRef.current = null;
        }
      }, 200);

      unavailableAutoActionTimeoutRef.current = window.setTimeout(() => {
        unavailableAutoActionTimeoutRef.current = null;
        acknowledgeUnavailableOverlay();
      }, advanceMs);
    } else {
      setUnavailableAutoAdvanceMs(null);
      setUnavailableAutoAdvanceSeconds(null);
    }

    unavailableOverlayTimeoutRef.current = null;
  }

  function showDeletedOverlayConfirmation() {
    clearUnavailableOverlayMessage();
    clearStuckPlaybackRetryTimer();
    clearStuckPlaybackWatchdogTimer();
    clearMidPlaybackBufferingCheck();

    setUnavailableOverlayKind("deleted");
    setUnavailableOverlayMessage(DELETED_TRACK_OVERLAY_MESSAGE);
    setShowEndedChoiceOverlay(false);
    setShowEndScreenCover(false);
    setUnavailableOverlayRequiresOk(true);
    setUnavailableAutoAdvanceMs(null);
    setUnavailableAutoAdvanceSeconds(null);
    unavailableOverlayTimeoutRef.current = null;
  }

  function hasActivePlaybackForCurrentVideo() {
    const runtimePlayer = playerRef.current;
    const runtimePlayerWithVideoData = runtimePlayer as (YouTubePlayer & {
      getVideoData?: () => { video_id?: string | null };
    }) | null;

    const runtimeVideoId =
      runtimePlayerWithVideoData && typeof runtimePlayerWithVideoData.getVideoData === "function"
        ? (runtimePlayerWithVideoData.getVideoData()?.video_id ?? null)
        : null;

    if (runtimeVideoId && runtimeVideoId !== currentVideoRef.current.id) {
      return false;
    }

    const runtimeState =
      runtimePlayer && typeof runtimePlayer.getPlayerState === "function"
        ? runtimePlayer.getPlayerState()
        : -1;
    const runtimeTime =
      runtimePlayer && typeof runtimePlayer.getCurrentTime === "function"
        ? toSafeNumber(runtimePlayer.getCurrentTime(), 0)
        : 0;

    return runtimeState === window.YT?.PlayerState.PLAYING || hasPlaybackStartedRef.current || runtimeTime > 1;
  }

  function restoreVisiblePlaybackStateFromRuntime(reason: string) {
    const runtimePlayer = playerRef.current;
    if (!runtimePlayer) {
      return;
    }

    const runtimePlayerWithVideoData = runtimePlayer as (YouTubePlayer & {
      getVideoData?: () => { video_id?: string | null };
    }) | null;
    const runtimeVideoId =
      runtimePlayerWithVideoData && typeof runtimePlayerWithVideoData.getVideoData === "function"
        ? (runtimePlayerWithVideoData.getVideoData()?.video_id ?? null)
        : null;

    if (runtimeVideoId && runtimeVideoId !== currentVideoRef.current.id) {
      return;
    }

    const runtimeState = typeof runtimePlayer.getPlayerState === "function"
      ? runtimePlayer.getPlayerState()
      : -1;
    const runtimeTime = typeof runtimePlayer.getCurrentTime === "function"
      ? toSafeNumber(runtimePlayer.getCurrentTime(), 0)
      : 0;
    const runtimeDuration = typeof runtimePlayer.getDuration === "function"
      ? toSafeNumber(runtimePlayer.getDuration(), 0)
      : 0;
    const runtimeMuted = typeof runtimePlayer.isMuted === "function"
      ? Boolean(runtimePlayer.isMuted())
      : isMutedRef.current;

    const playbackActive = runtimeState === window.YT?.PlayerState.PLAYING || runtimeTime > 1;
    if (!playbackActive) {
      return;
    }

    setIsPlayerReady(true);
    setShowPlayerRefreshHint(false);
    setIsPlaying(true);
    setHasPlaybackStarted(true);
    hasPlaybackStartedRef.current = true;
    setCurrentTime(runtimeTime);
    if (runtimeDuration > 0) {
      setDuration(runtimeDuration);
    }
    if (runtimeMuted !== isMutedRef.current) {
      setIsMuted(runtimeMuted);
    }
    resetPlaybackStallWatchdog(runtimeTime);

    logPlayerDebug("bot-challenge:restored-visible-playback-state", {
      videoId: currentVideoRef.current.id,
      reason,
      runtimeState,
      runtimeTime,
      runtimeDuration,
      runtimeMuted,
    });
  }

  function enableDirectIframeInteractionMode(trigger: string, verificationReason: string | null) {
    if (hasActivePlaybackForCurrentVideo()) {
      setAllowDirectIframeInteraction(false);
      allowDirectIframeInteractionRef.current = false;
      restoreVisiblePlaybackStateFromRuntime("direct-iframe-suppressed-active-playback");
      logPlayerDebug("bot-challenge:direct-iframe-mode-suppressed-active-playback", {
        videoId: currentVideoRef.current.id,
        trigger,
        verificationReason,
      });
      return;
    }

    if (overlayTimeoutRef.current) {
      window.clearTimeout(overlayTimeoutRef.current);
      overlayTimeoutRef.current = null;
    }

    clearUnavailableOverlayMessage();
    setShowNowPlayingOverlay(false);
    setShowControls(false);
    setShowShareMenu(false);
    setShowPlayerRefreshHint(false);
    playbackStallStartedAtRef.current = null;
    playbackStallLastTimeRef.current = null;
    playbackStallLastObservedAtRef.current = null;
    allowDirectIframeInteractionRef.current = true;
    setAllowDirectIframeInteraction(true);

    logPlayerDebug("bot-challenge:direct-iframe-mode", {
      videoId: currentVideoRef.current.id,
      trigger,
      verificationReason,
    });
  }

  function applyVerifiedPlaybackFailurePresentation(
    trigger: string,
    runtimeReason: string,
    reportResult: ReportUnavailableResult,
    options?: { unavailableMessage?: string; unavailableCountdownMs?: number },
  ) {
    const presentation = resolveVerifiedPlaybackFailurePresentation({
      runtimeReason,
      reportResult,
      unavailableMessage: options?.unavailableMessage,
      unavailableCountdownMs: options?.unavailableCountdownMs,
      connectivityMessage: UPSTREAM_CONNECTIVITY_OVERLAY_MESSAGE,
      copyrightMessage: COPYRIGHT_CLAIM_OVERLAY_MESSAGE,
      removedOrPrivateMessage: REMOVED_PRIVATE_OVERLAY_MESSAGE,
    });

    logPlayerDebug("playback-failure:presentation", {
      videoId: currentVideoRef.current.id,
      trigger,
      runtimeReason,
      verificationReason: reportResult.verificationReason,
      classification: reportResult.classification,
      shouldSkip: reportResult.shouldSkip,
      skipped: reportResult.skipped,
      presentation: presentation.kind,
    });

    if (presentation.kind === "direct-iframe") {
      clearStuckPlaybackRetryTimer();
      clearStuckPlaybackWatchdogTimer();
      clearMidPlaybackBufferingCheck();
      enableDirectIframeInteractionMode(trigger, reportResult.verificationReason);
      return;
    }

    autoplaySuppressedVideoIdRef.current = currentVideoRef.current.id;
    playAttemptedAtRef.current = null;
    pauseActivePlayback();
    showUnavailableOverlayMessage(presentation.message, {
      requiresOk: presentation.requiresOk,
      autoAdvanceWhenAutoplay: presentation.autoAdvanceWhenAutoplay,
      countdownMs: presentation.countdownMs,
    });
  }

  function resetPlaybackStallWatchdog(lastTime?: number | null) {
    playbackStallStartedAtRef.current = null;
    playbackStallLastTimeRef.current = typeof lastTime === "number" ? lastTime : null;
    playbackStallLastObservedAtRef.current = Date.now();
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

  function clearEarlyPlaybackVerificationTimer() {
    if (earlyPlaybackVerificationTimeoutRef.current !== null) {
      window.clearTimeout(earlyPlaybackVerificationTimeoutRef.current);
      earlyPlaybackVerificationTimeoutRef.current = null;
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
        const stillBlocked =
          state !== window.YT?.PlayerState.PLAYING
          && (durationValue <= 0 || currentPosition < 1.5);

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

        const reportResult = await reportUnavailableFromPlayer("yt-player-upstream-connect-timeout");
        logPlayerDebug("runtime-block-check", {
          videoId: currentVideoRef.current.id,
          playerHostMode,
          shouldSkip: reportResult.shouldSkip,
          verificationReason: reportResult.verificationReason,
          botChallengeDetected: isInteractivePlaybackBlockReason(reportResult.verificationReason),
          durationValue,
          currentPosition,
          state,
          retryAttempt: stuckPlaybackRetryCountRef.current,
          trigger,
        });

        applyVerifiedPlaybackFailurePresentation(trigger, "yt-player-upstream-connect-timeout", reportResult);
      })();
    }, STUCK_PLAYBACK_CHECK_MS);
  }

  function notePlayAttempt() {
    playAttemptedAtRef.current = Date.now();
    clearEarlyPlaybackVerificationTimer();

    const targetVideoId = currentVideoRef.current.id;
    earlyPlaybackVerificationTimeoutRef.current = window.setTimeout(() => {
      earlyPlaybackVerificationTimeoutRef.current = null;

      void (async () => {
        if (currentVideoRef.current.id !== targetVideoId) {
          return;
        }

        const player = playerRef.current;
        if (!player || !playAttemptedAtRef.current) {
          return;
        }

        const state = typeof player.getPlayerState === "function" ? player.getPlayerState() : -1;
        const durationValue = typeof player.getDuration === "function" ? toSafeNumber(player.getDuration(), 0) : 0;
        const currentPosition = typeof player.getCurrentTime === "function" ? toSafeNumber(player.getCurrentTime(), 0) : 0;
        const stillUnstarted =
          state !== window.YT?.PlayerState.PLAYING
          && (durationValue <= 0 || currentPosition < 0.25);

        if (!stillUnstarted) {
          return;
        }

        const runtimeReason = "yt-player-early-refusal-check";
        const reportResult = await reportUnavailableFromPlayer(runtimeReason);

        logPlayerDebug("early-playback-verification", {
          videoId: currentVideoRef.current.id,
          playerHostMode,
          verificationReason: reportResult.verificationReason,
          botChallengeDetected: isInteractivePlaybackBlockReason(reportResult.verificationReason),
          durationValue,
          currentPosition,
          state,
        });

        applyVerifiedPlaybackFailurePresentation("early-playback-verification", runtimeReason, reportResult);
      })();
    }, EARLY_PLAYBACK_VERIFICATION_MS);

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
          dispatchAppEvent(EVENT_NAMES.WATCH_HISTORY_UPDATED, { videoId: activeVideoId });
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
    reportedUnavailableVerificationReasonRef.current = null;
    autoplaySuppressedVideoIdRef.current = null;
    playAttemptedAtRef.current = null;
    stuckPlaybackRetryCountRef.current = 0;
    clearStuckPlaybackRetryTimer();
    clearStuckPlaybackWatchdogTimer();
    clearEarlyPlaybackVerificationTimer();
    clearUnavailableOverlayMessage();
    setShowEndedChoiceOverlay(false);
    setShowEndScreenCover(false);
    setEndedChoiceFromUnavailable(false);
    setHasPlaybackStarted(false);
    hasPlaybackStartedRef.current = false;
    setShowControls(false);
    resetPlaybackStallWatchdog();
    setAllowDirectIframeInteraction(false);
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

    const targetVideoId = currentVideo.id;
    const capturedMessage = forcedUnavailableMessage;

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
        videoId: targetVideoId,
        runtimeState,
        runtimeTime,
      });
      return;
    }

    // Delay before showing the overlay so the YouTube player has a chance to
    // establish playback. If the video actually plays (database/embed state
    // mismatch), onStateChange(PLAYING) will call clearUnavailableOverlayMessage
    // before the timeout fires, preventing a false-positive error banner.
    const timeoutId = window.setTimeout(() => {
      if (currentVideoRef.current.id !== targetVideoId) {
        return;
      }

      const postDelayPlayer = playerRef.current;
      const postDelayState =
        postDelayPlayer && typeof postDelayPlayer.getPlayerState === "function"
          ? postDelayPlayer.getPlayerState()
          : -1;
      const postDelayTime =
        postDelayPlayer && typeof postDelayPlayer.getCurrentTime === "function"
          ? toSafeNumber(postDelayPlayer.getCurrentTime(), 0)
          : 0;
      const playbackEstablishedAfterDelay =
        postDelayState === window.YT?.PlayerState.PLAYING
        || hasPlaybackStartedRef.current
        || postDelayTime > 1;

      if (playbackEstablishedAfterDelay) {
        logPlayerDebug("forced-unavailable:ignored-playback-established-after-delay", {
          videoId: targetVideoId,
          postDelayState,
          postDelayTime,
        });
        return;
      }

      autoplaySuppressedVideoIdRef.current = targetVideoId;
      pauseActivePlayback();
      showUnavailableOverlayMessage(capturedMessage, {
        autoAdvanceWhenAutoplay: true,
      });
    }, EARLY_PLAYBACK_VERIFICATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [currentVideo.id, forcedUnavailableMessage, forcedUnavailableSignal]);

  useEffect(() => {
    if (!allowDirectIframeInteraction) {
      return;
    }

    if (!hasActivePlaybackForCurrentVideo()) {
      return;
    }

    // If playback recovered while the policy blocker was visible, drop back to normal player UI.
    setAllowDirectIframeInteraction(false);
    allowDirectIframeInteractionRef.current = false;
    restoreVisiblePlaybackStateFromRuntime("direct-iframe-cleared-active-playback");
    logPlayerDebug("bot-challenge:direct-iframe-mode-cleared-active-playback", {
      videoId: currentVideo.id,
    });
  }, [allowDirectIframeInteraction, currentVideo.id, isPlaying, safeCurrentTime]);

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

    const unsubscribe = listenToAppEvent(EVENT_NAMES.ADMIN_OVERLAY_ENTER, handleAdminOverlayEnter);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    function handleReplayRequest(payload: { videoId: string }) {
      const requestedVideoId = typeof payload.videoId === "string" ? payload.videoId : null;

      if (!requestedVideoId || requestedVideoId !== currentVideoRef.current.id) {
        return;
      }

      if (!showEndedChoiceOverlay) {
        return;
      }

      handleEndedChoiceWatchAgain();
    }

    const unsubscribe = listenToAppEvent(EVENT_NAMES.REQUEST_VIDEO_REPLAY, handleReplayRequest);
    return () => unsubscribe();
  }, [showEndedChoiceOverlay]);

  async function reportUnavailableFromPlayer(reason: string): Promise<ReportUnavailableResult> {
    if (reportedUnavailableVideoIdRef.current === currentVideo.id) {
      logPlayerDebug("report-unavailable:already-reported", {
        videoId: currentVideo.id,
        reason,
      });
      return {
        shouldSkip: false,
        verificationReason: reportedUnavailableVerificationReasonRef.current,
        classification: null,
        skipped: true,
      };
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
            classification?: string;
          }
        | null;

      logPlayerDebug("report-unavailable:response", {
        videoId: currentVideo.id,
        reason,
        httpStatus: response.status,
        responseOk: response.ok,
        payload,
      });

      const verificationReason = typeof payload?.reason === "string" ? payload.reason : null;
      const classification = typeof payload?.classification === "string" ? payload.classification : null;
      const skipped = payload?.skipped === true;
      reportedUnavailableVerificationReasonRef.current = verificationReason;

      return {
        shouldSkip: Boolean(response.ok && payload?.ok && !skipped),
        verificationReason,
        classification,
        skipped,
      };
    } catch {
      // best-effort runtime reporting
      logPlayerDebug("report-unavailable:network-error", {
        videoId: currentVideo.id,
        reason,
      });
      return {
        shouldSkip: false,
        verificationReason: null,
        classification: null,
        skipped: false,
      };
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
    setAllowDirectIframeInteraction(false);
    reportedUnavailableVideoIdRef.current = null;
    reportedUnavailableVerificationReasonRef.current = null;
    autoplaySuppressedVideoIdRef.current = null;
    playAttemptedAtRef.current = null;
    stuckPlaybackRetryCountRef.current = 0;
    setPlayerReloadNonce((currentNonce) => currentNonce + 1);
  }

  function handleOpenCurrentTrackOnYouTube() {
    if (typeof window === "undefined") {
      return;
    }

    window.open(currentTrackYouTubeUrl, "_blank", "noopener,noreferrer");
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

    if (!isLoggedIn) {
      if (progressIntervalRef.current) {
        window.clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }

      if (typeof playerRef.current?.destroy === "function") {
        playerRef.current.destroy();
      }

      playerRef.current = null;
      setIsPlayerReady(false);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setShowPlayerRefreshHint(false);
      setAllowDirectIframeInteraction(false);
      return;
    }

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

              setAllowDirectIframeInteraction(false);
              clearUnavailableOverlayMessage();
              clearStuckPlaybackRetryTimer();
              clearStuckPlaybackWatchdogTimer();
              clearEarlyPlaybackVerificationTimer();
              clearMidPlaybackBufferingCheck();
              stuckPlaybackRetryCountRef.current = 0;
              playAttemptedAtRef.current = null;
              setHasPlaybackStarted(true);
              hasPlaybackStartedRef.current = true;

              const startedTime = playerRef.current && typeof playerRef.current.getCurrentTime === "function"
                ? toSafeNumber(playerRef.current.getCurrentTime(), 0)
                : currentTime;
              resetPlaybackStallWatchdog(startedTime);
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
                  const now = Date.now();
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

                  const previousTime = playbackStallLastTimeRef.current;
                  const previousObservedAt = playbackStallLastObservedAtRef.current;
                  const nearEnd = liveDuration > 0 && (liveDuration - liveTime) <= 1.5;
                  const hasProgressed =
                    previousTime === null
                    || liveTime > (previousTime + PLAYBACK_STALL_PROGRESS_EPSILON_SECONDS);

                  if (!allowDirectIframeInteractionRef.current && !isScrubbingRef.current && !nearEnd) {
                    if (hasProgressed) {
                      playbackStallStartedAtRef.current = null;
                    } else if (previousObservedAt !== null && (now - previousObservedAt) >= 400) {
                      if (playbackStallStartedAtRef.current === null) {
                        playbackStallStartedAtRef.current = now;
                      } else if ((now - playbackStallStartedAtRef.current) >= PLAYBACK_STALL_DIRECT_IFRAME_THRESHOLD_MS) {
                        enableDirectIframeInteractionMode("progress-stall", reportedUnavailableVerificationReasonRef.current);
                        if (progressIntervalRef.current) {
                          window.clearInterval(progressIntervalRef.current);
                          progressIntervalRef.current = null;
                        }
                        return;
                      }
                    }
                  }

                  playbackStallLastTimeRef.current = liveTime;
                  playbackStallLastObservedAtRef.current = now;

                  const activeVideoId = currentVideoRef.current.id;
                  const secondsRemaining = liveDuration > 0 ? liveDuration - liveTime : Infinity;

                  const shouldPrewarmEndedChoice =
                    liveDuration > 0
                    && secondsRemaining <= ENDED_CHOICE_PREFETCH_BEFORE_END_SECONDS
                    && !autoplayEnabledRef.current
                    && endedChoicePrewarmVideoIdRef.current !== activeVideoId
                    && !endedChoiceOverlayVisibleRef.current
                    && !endedChoiceFetchingRef.current;

                  if (shouldPrewarmEndedChoice) {
                    endedChoicePrewarmVideoIdRef.current = activeVideoId;
                    endedChoiceUserScrolledRef.current = false;
                    endedChoiceHasMoreRef.current = true;
                    endedChoiceSkipRef.current = 0;
                    endedChoicePostPrimeQueuedRef.current = false;
                    setEndedChoiceRemoteVideos([]);
                    void fetchEndedChoiceSets(ENDED_CHOICE_INITIAL_PREFETCH_COUNT, {
                      background: true,
                      schedulePostPrimeBatch: true,
                    });
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
              resetPlaybackStallWatchdog();
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
              window.dispatchEvent(new CustomEvent(VIDEO_ENDED_EVENT, {
                detail: {
                  videoId: activeVideoId,
                  reason: "ended",
                },
              }));
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
            const runtimePlayerWithVideoData = runtimePlayer as (YouTubePlayer & {
              getVideoData?: () => { video_id?: string | null };
            }) | null;
            const runtimeVideoId =
              runtimePlayerWithVideoData && typeof runtimePlayerWithVideoData.getVideoData === "function"
                ? (runtimePlayerWithVideoData.getVideoData()?.video_id ?? null)
                : null;

            if (runtimeVideoId && runtimeVideoId !== activeVideoId) {
              logPlayerDebug("onError:ignore-stale-runtime-video", {
                activeVideoId,
                runtimeVideoId,
                errorCode: event.data,
              });
              return;
            }

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
            const isRestrictedEmbedCode = event.data === 101 || event.data === 150;

            const isDefinitiveBrokenUpstreamCode = event.data === 100;

            if (isRestrictedEmbedCode) {
              const reportResult = await reportUnavailableFromPlayer(reason);
              applyVerifiedPlaybackFailurePresentation("on-error-restricted", reason, reportResult);
              return;
            }

            if (isDefinitiveBrokenUpstreamCode) {
              autoplaySuppressedVideoIdRef.current = currentVideo.id;
              playAttemptedAtRef.current = null;
              pauseActivePlayback();
              showUnavailableOverlayMessage(BROKEN_UPSTREAM_OVERLAY_MESSAGE, {
                autoAdvanceWhenAutoplay: true,
                countdownMs: BROKEN_UPSTREAM_AUTOADVANCE_MS,
              });

              void reportUnavailableFromPlayer(reason).then((reportResult) => {
                logPlayerDebug("onError:broken-upstream-reported", {
                  videoId: currentVideo.id,
                  reason,
                  shouldSkip: reportResult.shouldSkip,
                  verificationReason: reportResult.verificationReason,
                  skipped: reportResult.skipped,
                });
              });
              return;
            }

            const reportResult = await reportUnavailableFromPlayer(reason);

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
              shouldSkip: reportResult.shouldSkip,
              verificationReason: reportResult.verificationReason,
              botChallengeDetected: isInteractivePlaybackBlockReason(reportResult.verificationReason),
              unavailableDetected: reportResult.shouldSkip || isUnavailableVerificationReason(reportResult.verificationReason),
              postReportState,
              postReportTime,
              playbackEstablishedAfterReport,
            });

            if (playbackEstablishedAfterReport) {
              return;
            }

            applyVerifiedPlaybackFailurePresentation("on-error", reason, reportResult);
          },
        },
      });
    };

    const INTERACTION_EVENTS = ["mousemove", "touchstart", "pointerdown", "keydown", "scroll"] as const;
    let removeInteractionListeners: (() => void) | null = null;

    const launchPlayer = () => {
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
    };

    if (didPageHaveUserInteraction) {
      launchPlayer();
    } else {
      const onFirstInteraction = () => {
        removeInteractionListeners?.();
        removeInteractionListeners = null;
        didPageHaveUserInteraction = true;
        launchPlayer();
      };
      INTERACTION_EVENTS.forEach((e) => window.addEventListener(e, onFirstInteraction, { passive: true }));
      removeInteractionListeners = () => {
        INTERACTION_EVENTS.forEach((e) => window.removeEventListener(e, onFirstInteraction));
      };
    }

    return () => {
      cancelled = true;
      removeInteractionListeners?.();
      clearStuckPlaybackRetryTimer();
      clearStuckPlaybackWatchdogTimer();
      clearMidPlaybackBufferingCheck();
    };
  }, [currentVideo.id, isLoggedIn, playerHostMode, playerReloadNonce]);

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
      clearEarlyPlaybackVerificationTimer();

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
    const runtimePathname = typeof window !== "undefined" && window.location.pathname
      ? window.location.pathname
      : pathname;
    const navigationPathname = runtimePathname || "/";
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

    router.push(`${navigationPathname}?${params.toString()}`, { scroll: false });
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

  async function fetchEndedChoiceSets(
    requestedCount: number,
    options?: { background?: boolean; schedulePostPrimeBatch?: boolean },
  ) {
    const isBackground = options?.background === true;
    const shouldSchedulePostPrimeBatch = options?.schedulePostPrimeBatch === true;
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

    if (requestedCount <= 0 || endedChoiceFetchingRef.current || !endedChoiceHasMoreRef.current) {
      return;
    }

    const take = Math.max(1, Math.min(60, Math.floor(requestedCount)));
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
      params.set("hideSeen", endedChoiceHideSeen ? "1" : "0");

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

      if (
        shouldSchedulePostPrimeBatch
        && !endedChoicePostPrimeQueuedRef.current
        && endedChoiceHasMoreRef.current
        && !endedChoiceUserScrolledRef.current
      ) {
        endedChoicePostPrimeQueuedRef.current = true;
        window.setTimeout(() => {
          void fetchEndedChoiceSets(ENDED_CHOICE_BATCH_SIZE, { background: true });
        }, 90);
      }

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

  function estimateEndedChoiceVisibleCount() {
    const overlay = endedChoiceOverlayRef.current;
    const columns = Math.max(1, getEndedChoiceColumns());

    if (!overlay) {
      return columns * 2;
    }

    const rowHeight = Math.max(1, endedChoiceRowHeightRef.current);
    const rowsVisible = Math.max(1, Math.ceil(overlay.clientHeight / rowHeight) + 1);
    return rowsVisible * columns;
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

  function computeCurrentEndedChoiceFirstVisibleIndex() {
    const overlay = endedChoiceOverlayRef.current;
    if (!overlay) {
      return 0;
    }

    const columns = Math.max(1, getEndedChoiceColumns());
    const rowHeight = Math.max(1, endedChoiceRowHeightRef.current);
    const rowsScrolled = Math.max(0, Math.floor(overlay.scrollTop / rowHeight));
    return Math.max(0, rowsScrolled * columns);
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

      if (!endedChoiceUserScrolledRef.current) {
        return;
      }

      const firstVisibleIndex = computeCurrentEndedChoiceFirstVisibleIndex();
      const visibleCount = estimateEndedChoiceVisibleCount();
      const currentRunway = endedChoiceGridVideos.length - (firstVisibleIndex + visibleCount);

      if (currentRunway < ENDED_CHOICE_SCROLL_RUNWAY_COUNT) {
        void fetchEndedChoiceSets(ENDED_CHOICE_BATCH_SIZE, { background: true });
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

  function shouldAutoPrimeEndedChoiceRunway() {
    if (
      !showEndedChoiceOverlay
      || endedChoiceUserScrolledRef.current
      || endedChoiceFetchingRef.current
      || !endedChoiceHasMoreRef.current
    ) {
      return false;
    }

    const overlay = endedChoiceOverlayRef.current;
    const isScrollable = overlay ? overlay.scrollHeight > overlay.clientHeight + 4 : false;
    const visibleCount = estimateEndedChoiceVisibleCount();
    const lowRunway = endedChoiceGridVideos.length < visibleCount + ENDED_CHOICE_SCROLL_RUNWAY_COUNT;

    const needsSeenRowFill = endedChoiceHideSeen
      && (visibleEndedChoiceVideos.length === 0 || visibleEndedChoiceVideos.length % 4 !== 0);

    return needsSeenRowFill || (!isScrollable && lowRunway);
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

      if (!endedChoicePostPrimeQueuedRef.current && endedChoiceHasMoreRef.current) {
        endedChoicePostPrimeQueuedRef.current = true;
        void fetchEndedChoiceSets(ENDED_CHOICE_BATCH_SIZE, { background: true });
      }

      return;
    }

    setEndedChoiceAnimateCards(true);
    endedChoiceHasMoreRef.current = true;
    endedChoiceSkipRef.current = 0;
    endedChoiceNoProgressStreakRef.current = 0;
    endedChoiceFailureStreakRef.current = 0;
    endedChoiceAutoRetryBlockedUntilRef.current = 0;
    endedChoicePostPrimeQueuedRef.current = false;
    setEndedChoiceRemoteVideos([]);
    void fetchEndedChoiceSets(ENDED_CHOICE_INITIAL_PREFETCH_COUNT, {
      schedulePostPrimeBatch: true,
    });
  }, [showEndedChoiceOverlay, currentVideo.id, endedChoiceReshuffleKey]);

  useEffect(() => {
    if (!shouldAutoPrimeEndedChoiceRunway()) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (!shouldAutoPrimeEndedChoiceRunway()) {
        return;
      }

      void fetchEndedChoiceSets(ENDED_CHOICE_BATCH_SIZE, { background: true });
    }, 60);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    endedChoiceGridVideos.length,
    endedChoiceHideSeen,
    showEndedChoiceOverlay,
    visibleEndedChoiceVideos.length,
  ]);

  useEffect(() => {
    const needsSeenRowFill =
      visibleEndedChoiceVideos.length === 0
      || (endedChoiceHideSeen && visibleEndedChoiceVideos.length % 4 !== 0);

    if (
      !showEndedChoiceOverlay
      || !endedChoiceUserScrolledRef.current
      || !needsSeenRowFill
      || endedChoiceFetchingRef.current
      || !endedChoiceHasMoreRef.current
    ) {
      return;
    }

    scheduleEndedChoicePrefetchCheck();
  }, [showEndedChoiceOverlay, endedChoiceVideos.length]);

  useEffect(() => {
    if (!showEndedChoiceOverlay || !endedChoiceUserScrolledRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      scheduleEndedChoicePrefetchCheck();
    }, 80);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    endedChoiceGridVideos.length,
    endedChoiceHideSeen,
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
      endedChoicePostPrimeQueuedRef.current = false;
      setEndedChoiceRemoteVideos([]);
      setEndedChoiceReshuffleKey((k) => k + 1);
      setEndedChoiceGridExiting(false);
    }, 280);
  }

  const handleEndedChoiceHide = useCallback((track: VideoRecord) => {
    if (endedChoiceHidingIds.includes(track.id)) {
      return;
    }

    setEndedChoiceHideConfirmVideo(track);
  }, [endedChoiceHidingIds]);

  const confirmEndedChoiceHide = useCallback(() => {
    const track = endedChoiceHideConfirmVideo;

    if (!track || endedChoiceHidingIds.includes(track.id)) {
      return;
    }

    setEndedChoiceHideConfirmVideo(null);
    setEndedChoiceHidingIds((prev) => [...prev, track.id]);
    void onHideVideo?.(track);
    setTimeout(() => {
      setEndedChoiceHidingIds((prev) => prev.filter((id) => id !== track.id));
      setEndedChoiceDismissedIds((prev) => (prev.includes(track.id) ? prev : [...prev, track.id]));
    }, 400);
  }, [endedChoiceHideConfirmVideo, endedChoiceHidingIds, onHideVideo]);

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

    const currentVideoWasQueued = temporaryQueue.some((video) => video.id === currentVideo.id);
    if (currentVideoWasQueued && nextTarget.videoId !== currentVideo.id) {
      window.dispatchEvent(new CustomEvent(TEMP_QUEUE_DEQUEUE_EVENT, {
        detail: {
          videoId: currentVideo.id,
          reason: "manual-next",
        },
      }));
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

  function handleDockedNewRouteNextTrack() {
    if (!isDockedNewRoute || footerActionsBlocked || routeAutoplayQueueIds.length === 0) {
      return;
    }

    const currentIndex = routeAutoplayQueueIds.findIndex((videoId) => videoId === currentVideo.id);
    const nextVideoId = currentIndex >= 0
      ? (routeAutoplayQueueIds[(currentIndex + 1) % routeAutoplayQueueIds.length] ?? null)
      : (routeAutoplayQueueIds[0] ?? null);

    if (!nextVideoId) {
      return;
    }

    showManualTransitionMask();
    hasUserGesturePlaybackUnlockRef.current = true;
    pendingAutoAdvanceVideoIdRef.current = nextVideoId;
    navigateToVideo(nextVideoId, {
      clearPlaylist: true,
      playlistId: activePlaylistId,
      playlistItemIndex: null,
    });
  }

  async function handleHideCurrentVideo() {
    if (!isLoggedIn || hideCurrentVideoState === "saving") {
      return;
    }

    setHideCurrentVideoState("saving");
    showManualTransitionMask();

    try {
      const result = await mutateHiddenVideo<{ activePlaylistDeleted?: boolean }>({
        action: "hide",
        videoId: currentVideo.id,
        activePlaylistId,
      });

      if (result.ok) {
        dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);

        if (result.payload?.activePlaylistDeleted) {
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
    const addResponse = await addPlaylistItemClient(
      { playlistId, videoId: currentVideo.id },
      { telemetryContext: { component: "player-experience-core", mode: "add-current-track" } },
    );

    if (!addResponse.ok) {
      return false;
    }

    dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);
    return true;
  }

  async function loadFooterPlaylistMenu() {
    setFooterPlaylistMenuLoading(true);

    try {
      const response = await listPlaylistsClient({
        telemetryContext: {
          component: "player-experience-core",
          mode: "footer-menu-list",
        },
      });

      if (!response.ok) {
        setFooterPlaylistMenuPlaylists([]);
        return;
      }

      setFooterPlaylistMenuPlaylists(response.data as PlaylistSummary[]);
    } catch {
      setFooterPlaylistMenuPlaylists([]);
    } finally {
      setFooterPlaylistMenuLoading(false);
    }
  }

  function triggerPlaylistDropAnimation() {
    if (typeof document === "undefined") {
      return;
    }

    const sourceRect = playerFrameRef.current?.getBoundingClientRect();
    const sourceWidth = sourceRect?.width ?? window.innerWidth * 0.56;
    const sourceHeight = sourceRect?.height ?? window.innerHeight * 0.4;
    const fromX = sourceRect ? sourceRect.left + sourceRect.width * 0.5 : window.innerWidth * 0.5;
    const fromY = sourceRect ? sourceRect.top + sourceRect.height * 0.5 : window.innerHeight * 0.45;

    const playlistTarget = document.querySelector(
      ".relatedStackPlaylistBody, .rightRailPlaylistBar, .rightRailTabs .activeTab, .rightRailTabs button:nth-child(2), .rightRail",
    ) as HTMLElement | null;
    const targetRect = playlistTarget?.getBoundingClientRect();
    const toX = targetRect ? targetRect.left + Math.min(120, Math.max(42, targetRect.width * 0.28)) : window.innerWidth * 0.84;
    const toY = targetRect ? targetRect.top + Math.min(84, Math.max(34, targetRect.height * 0.24)) : window.innerHeight * 0.24;

    const maxStartHeight = sourceRect ? sourceRect.height * 0.92 : window.innerHeight * 0.54;
    let fromWidth = sourceRect ? sourceRect.width * 0.9 : window.innerWidth * 0.68;
    let fromHeight = (fromWidth * 9) / 16;
    if (fromHeight > maxStartHeight) {
      fromHeight = maxStartHeight;
      fromWidth = (fromHeight * 16) / 9;
    }
    fromWidth = Math.max(320, Math.min(fromWidth, window.innerWidth * 0.9));
    fromHeight = Math.round((fromWidth * 9) / 16);
    const targetWidth = 76;
    const scale = targetWidth / fromWidth;

    setPlaylistDropAnimation({
      key: Date.now(),
      thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(currentVideo.id)}/mqdefault.jpg`,
      fromX,
      fromY,
      deltaX: toX - fromX,
      deltaY: toY - fromY,
      fromWidth,
      fromHeight,
      scale,
    });

    if (playlistDropAnimationTimeoutRef.current !== null) {
      window.clearTimeout(playlistDropAnimationTimeoutRef.current);
    }
    playlistDropAnimationTimeoutRef.current = window.setTimeout(() => {
      setPlaylistDropAnimation(null);
      playlistDropAnimationTimeoutRef.current = null;
    }, 620);
  }

  function markFooterPlaylistAdded() {
    setFooterPlaylistAddState("added");
    window.setTimeout(() => {
      setFooterPlaylistAddState((current) => (current === "added" ? "idle" : current));
    }, 1800);
  }

  function markFooterPlaylistError() {
    setFooterPlaylistAddState("error");
    window.setTimeout(() => {
      setFooterPlaylistAddState((current) => (current === "error" ? "idle" : current));
    }, 2200);
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

    setShowFooterPlaylistMenu(false);
    setFooterShowExistingList(false);
    setFooterPlaylistAddState("saving");
    triggerPlaylistDropAnimation();

    dispatchAppEvent(EVENT_NAMES.RIGHT_RAIL_MODE, {
      mode: "playlist",
      playlistId,
      trackId: currentVideo.id,
    });

    try {
      const ok = await addCurrentTrackToPlaylist(playlistId);
      if (ok) {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(LAST_PLAYLIST_ID_KEY, playlistId);
        }
        markFooterPlaylistAdded();

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
      markFooterPlaylistError();
    } catch {
      markFooterPlaylistError();
    }
  }

  async function handleFooterCreatePlaylistNoOpen() {
    if (footerPlaylistAddState === "saving") {
      return;
    }

    setShowFooterPlaylistMenu(false);
    setFooterShowExistingList(false);
    setFooterPlaylistAddState("saving");
    triggerPlaylistDropAnimation();

    try {
      const createResponse = await createPlaylistClient(
        { name: buildGeneratedPlaylistName(), videoIds: [] },
        { telemetryContext: { component: "player-experience-core", mode: "footer-create-no-open" } },
      );

      if (!createResponse.ok) {
        markFooterPlaylistError();
        return;
      }

      const created = createResponse.data as { id?: string };
      if (!created?.id) {
        markFooterPlaylistError();
        return;
      }

      dispatchAppEvent(EVENT_NAMES.RIGHT_RAIL_MODE, {
        mode: "playlist",
        playlistId: created.id,
        trackId: currentVideo.id,
      });

      const added = await addCurrentTrackToPlaylist(created.id);
      if (!added) {
        markFooterPlaylistError();
        return;
      }

      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAST_PLAYLIST_ID_KEY, created.id);
      }

      markFooterPlaylistAdded();
    } catch {
      markFooterPlaylistError();
    }
  }

  async function handleFooterCreatePlaylist() {
    if (footerPlaylistAddState === "saving") {
      return;
    }

    setShowFooterPlaylistMenu(false);
    setFooterShowExistingList(false);
    setFooterPlaylistAddState("saving");
    triggerPlaylistDropAnimation();

    try {
      const createResponse = await createPlaylistClient(
        {
          name: buildGeneratedPlaylistName(),
          videoIds: [],
        },
        { telemetryContext: { component: "player-experience-core", mode: "footer-create-open" } },
      );

      if (!createResponse.ok) {
        markFooterPlaylistError();
        return;
      }

      const created = createResponse.data as { id?: string };
      if (!created?.id) {
        markFooterPlaylistError();
        return;
      }

      dispatchAppEvent(EVENT_NAMES.RIGHT_RAIL_MODE, {
        mode: "playlist",
        playlistId: created.id,
        trackId: currentVideo.id,
      });

      const added = await addCurrentTrackToPlaylist(created.id);
      if (!added) {
        markFooterPlaylistError();
        return;
      }

      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAST_PLAYLIST_ID_KEY, created.id);
      }

      markFooterPlaylistAdded();

      const params = new URLSearchParams(searchParams.toString());
      params.set("v", currentVideo.id);
      params.set("resume", "1");
      params.set("pl", created.id);
      params.delete("pli");
      router.replace(`${pathname}?${params.toString()}`);
    } catch {
      markFooterPlaylistError();
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

    const autoplaySource = resolveRouteAutoplaySource(pathname);

    if (autoplaySource) {
      autoplayRouteTransitionRef.current = true;
      const { playlistId, firstVideoId } = await buildRouteAutoplayPlaylist(autoplaySource);
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
        setIsCurrentVideoFavourited(true);
        dispatchAppEvent(EVENT_NAMES.FAVOURITES_UPDATED, null);
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

  async function handleRemoveFavourite() {
    if (!isLoggedIn || removeFavouriteState === "removing") {
      return;
    }

    setRemoveFavouriteState("removing");

    try {
      const response = await fetchWithAuthRetry("/api/favourites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: currentVideo.id, action: "remove" }),
      });

      if (!response.ok) {
        return;
      }

      setIsCurrentVideoFavourited(false);
      setShowRemoveFavouriteConfirm(false);
      setFavouriteSaveState("idle");
      dispatchAppEvent(EVENT_NAMES.FAVOURITES_UPDATED, null);
    } finally {
      setRemoveFavouriteState("idle");
    }
  }

  function handleOpenLyrics() {
    if (lyricsUnavailableForCurrentVideo) {
      return;
    }

    dispatchAppEvent(EVENT_NAMES.RIGHT_RAIL_LYRICS_OPEN, { videoId: currentVideo.id });
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
        resetPlaybackStallWatchdog(seconds);
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
          const response = await fetchWithAuthRetry(`/api/admin/videos?q=${encodeURIComponent(currentVideo.id)}`, {
            method: "GET",
            cache: "no-store",
          });

          if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
              setAdminEditError("Admin session expired. Please sign in again.");
              return;
            }
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
          const response = await fetchWithAuthRetry("/api/admin/videos", {
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
            if (response.status === 401 || response.status === 403) {
              setAdminEditError("Admin session expired. Please sign in again.");
              return;
            }
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
          const response = await fetchWithAuthRetry("/api/admin/videos", {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              videoId: deletingVideoId,
            }),
          });

          if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as { error?: string; reason?: string } | null;
            if (response.status === 401 || response.status === 403) {
              showUnavailableOverlayMessage("Admin session expired. Please sign in again.");
              return;
            }
            showUnavailableOverlayMessage(payload?.error || "Could not remove this video from the site.");
            return;
          }

          dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);
          dispatchAppEvent(EVENT_NAMES.FAVOURITES_UPDATED, null);
          dispatchAppEvent(EVENT_NAMES.VIDEO_CATALOG_DELETED, { videoId: deletingVideoId });
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
            const params = typeof window !== "undefined"
              ? new URLSearchParams(window.location.search)
              : new URLSearchParams(searchParams.toString());
            params.delete("v");
            params.delete("pl");
            params.delete("pli");
            const query = params.toString();
            router.replace(query ? `${pathname}?${query}` : pathname);
            onDockHideRequest?.();
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("ytr:dock-hide-request"));
            }
            return;
          }

          if (activePlaylistId) {
            const remainingPlaylistIds = playlistQueueIds.filter((id) => id !== deletingVideoId);
            if (remainingPlaylistIds.length > 0) {
              nextPlaylistIndexRef.current = Math.max(0, Math.min(
                effectivePlaylistIndex ?? playlistQueueIds.findIndex((id) => id === deletingVideoId),
                remainingPlaylistIds.length - 1,
              ));
            }
          }

          showDeletedOverlayConfirmation();
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
          {playlistDropAnimation ? (
            <div
              key={playlistDropAnimation.key}
              className="playlistDropGhost"
              aria-hidden="true"
              style={{
                left: `${playlistDropAnimation.fromX - playlistDropAnimation.fromWidth * 0.5}px`,
                top: `${playlistDropAnimation.fromY - playlistDropAnimation.fromHeight * 0.5}px`,
                width: `${playlistDropAnimation.fromWidth}px`,
                height: `${playlistDropAnimation.fromHeight}px`,
                "--playlist-drop-dx": `${playlistDropAnimation.deltaX}px`,
                "--playlist-drop-dy": `${playlistDropAnimation.deltaY}px`,
                "--playlist-drop-scale": String(playlistDropAnimation.scale),
              } as CSSProperties}
            >
              <img src={playlistDropAnimation.thumbnailUrl} alt="" loading="eager" className="playlistDropGhostImage" />
            </div>
          ) : null}

          {!suppressUnavailablePlaybackSurface ? (
            <div
              ref={playerFrameRef}
              className={playerFrameClassName}
              onMouseEnter={() => {
                if (!allowDirectIframeInteraction) {
                  setShowControls(true);
                }
              }}
              onMouseLeave={() => {
                if (isPlaying && !allowDirectIframeInteraction) {
                  setShowControls(false);
                  setShowShareMenu(false);
                }
              }}
              onFocusCapture={handlePlayerFrameFocusCapture}
              onBlurCapture={handlePlayerFrameBlurCapture}
            >
              <div
                ref={playerElementRef}
                className={allowDirectIframeInteraction ? "playerMount playerMountHidden" : "playerMount"}
              />

              {!isLoggedIn && !suppressAuthWall ? (
                <div className="playerAuthWall" role="region" aria-label="Sign in to watch">
                  <img
                    src={`https://i.ytimg.com/vi/${encodeURIComponent(currentVideo.id)}/hqdefault.jpg`}
                    alt=""
                    aria-hidden="true"
                    className="playerAuthWallThumb"
                  />
                  <div className="playerAuthWallContent">
                    <strong className="playerAuthWallTitle">Sign in to watch</strong>
                    <p className="playerAuthWallDetail">{currentVideo.title}</p>
                    <button
                      type="button"
                      className="navLink navLinkActive playerAuthWallBtn"
                      onClick={onAuthRequired}
                    >
                      Sign in
                    </button>
                  </div>
                </div>
              ) : null}

              {showPlayerLoadingOverlay && !allowDirectIframeInteraction ? (
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
                    </div>
                  ) : null}
                </div>
              ) : null}

              {isPlayerReady && !allowDirectIframeInteraction && (
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

              {showNowPlayingOverlay && !allowDirectIframeInteraction ? (
                <div key={`${currentVideo.id}-${overlayInstance}`} className="nowPlayingOverlay nowPlayingOverlayAnimate">
                  <p className="statusLabel">Now playing</p>
                  <strong>{displayTitle}</strong>
                </div>
              ) : null}

              {allowDirectIframeInteraction ? (
                <div className="playerPolicyBlocker" role="alert" aria-live="polite">
                  <h2 className="playerPolicyBlockerHeader">Well hot-damn...</h2>
                  <p className="playerPolicyBlockerEyebrow">Playback blocked by upstream policy</p>
                  <strong className="playerPolicyBlockerTitle">This video cannot play inside the embedded player right now</strong>
                  <p className="playerPolicyBlockerBody">
                    Sorry, this is caused by YouTube policy controls, not a YehThatRocks platform failure.
                    Watching on YouTube for a moment often lifts the block entirely, so normal embedded playback will
                    probably be back when you return. If not, please try again later. In the meantime you can still
                    browse our catalog and your favourites to find tracks you want to watch, you will just have to
                    watch them through YouTube directly instead of in our awesome player.
                  </p>
                  <button
                    type="button"
                    className="playerPolicyBlockerButton"
                    onClick={handleOpenCurrentTrackOnYouTube}
                  >
                    Watch on YouTube
                  </button>
                </div>
              ) : null}

            </div>
          ) : null}

          {unavailableOverlayMessage && !allowDirectIframeInteraction ? (
            <div className={isAutoAdvanceUnavailableOverlay ? "videoUnavailableOverlay videoUnavailableOverlayAutoAdvance" : "videoUnavailableOverlay"} role="alertdialog" aria-modal="true" aria-label={isDeletedConfirmationOverlay ? "Track deleted" : "Video unavailable"}>
              <p className="videoUnavailableOverlayEyebrow">
                {isDeletedConfirmationOverlay
                  ? "Removed from YehThatRocks"
                  : isCopyrightClaimOverlay
                    ? "Copyright claim on YouTube"
                    : isRemovedOrPrivateOverlay
                      ? "Removed or private on YouTube"
                  : isBrokenUpstreamOverlay
                    ? "Not available on YouTube"
                    : isUpstreamConnectivityOverlay
                      ? "Provider connection timeout"
                      : "Playback issue"}
              </p>
              <strong className="videoUnavailableOverlayTitle">
                {isDeletedConfirmationOverlay
                  ? "Track deleted"
                  : isCopyrightClaimOverlay
                    ? "Copyright claim detected"
                    : isRemovedOrPrivateOverlay
                      ? "This track is no longer public"
                  : isBrokenUpstreamOverlay
                    ? "This track no longer exists"
                    : isUpstreamConnectivityOverlay
                      ? "Could not start this track yet"
                      : "This track is unavailable"}
              </strong>
              <p className="videoUnavailableOverlayBody">{unavailableOverlayMessage}</p>
              {!isDeletedConfirmationOverlay && isAutoAdvanceUnavailableOverlay && unavailableAutoAdvanceSeconds !== null ? (
                <p className="videoUnavailableAutoAdvanceNote" aria-live="polite">
                  Another video will be selected automatically in {unavailableAutoAdvanceSeconds}.
                </p>
              ) : null}
              {!isDeletedConfirmationOverlay && isAutoAdvanceUnavailableOverlay && unavailableAutoAdvanceMs !== null ? (
                <div
                  className="videoUnavailableCountdown"
                  style={{ "--countdown-ms": `${unavailableAutoAdvanceMs}ms` } as React.CSSProperties}
                  aria-hidden="true"
                />
              ) : null}
              <div className="videoUnavailableOverlayActions">
                {!isDeletedConfirmationOverlay && !isBrokenUpstreamOverlay && isUpstreamConnectivityOverlay ? (
                  <button
                    type="button"
                    className="videoUnavailableOverlayRefresh"
                    onClick={handleReloadPlayerIframe}
                  >
                    Retry connection
                  </button>
                ) : null}
                {isDeletedConfirmationOverlay ? (
                  <button
                    type="button"
                    className="videoUnavailableOverlayAcknowledge"
                    onClick={acknowledgeDeletedOverlay}
                  >
                    Next track
                  </button>
                ) : isBrokenUpstreamOverlay ? (
                  <button
                    type="button"
                    className="videoUnavailableOverlayAcknowledge"
                    onClick={acknowledgeUnavailableOverlay}
                  >
                    {unavailableAutoAdvanceMs !== null ? "Continue now" : "Next track"}
                  </button>
                ) : unavailableOverlayRequiresOk ? (
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

          <HideVideoConfirmModal
            isOpen={endedChoiceHideConfirmVideo !== null}
            video={endedChoiceHideConfirmVideo}
            isPending={endedChoiceHideConfirmVideo ? endedChoiceHidingIds.includes(endedChoiceHideConfirmVideo.id) : false}
            onCancel={() => setEndedChoiceHideConfirmVideo(null)}
            onConfirm={confirmEndedChoiceHide}
          />

          <RemoveFavouriteConfirmModal
            isOpen={showRemoveFavouriteConfirm}
            video={showRemoveFavouriteConfirm ? { id: currentVideo.id, title: displayTitle } : null}
            isPending={removeFavouriteState === "removing"}
            onCancel={() => setShowRemoveFavouriteConfirm(false)}
            onConfirm={() => {
              void handleRemoveFavourite();
            }}
          />

          <div className="playerFooterReserve">
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
                  className={isCurrentVideoFavourited ? "primaryActionIconButton primaryActionIconButtonFavourited" : "primaryActionIconButton"}
                  aria-label={isCurrentVideoFavourited ? "Remove from favourites" : "Add to favourites"}
                  title={isCurrentVideoFavourited ? "Remove from favourites" : "Add to favourites"}
                  disabled={favouriteSaveState === "saving" || removeFavouriteState === "removing" || footerActionsBlocked}
                  onClick={() => {
                    if (isCurrentVideoFavourited) {
                      setShowRemoveFavouriteConfirm(true);
                      return;
                    }

                    void handleAddFavourite();
                  }}
                >
                  <span className="navFavouritesGlyph" aria-hidden="true">❤️</span>
                </button>
              </div>
            )}
            {isLoggedIn && !showEndedChoiceOverlay ? (
              <div className="primaryActionIconButtonWrap primaryActionPlaylistWrap" ref={footerPlaylistMenuRef}>
                {footerPlaylistAddState === "saving" ? (
                  <div className="favouriteSavedToast playlistActionToast" role="status" aria-live="polite">
                    <span className="playlistActionToastSpinner" aria-hidden="true" />
                    <span>Adding...</span>
                  </div>
                ) : null}
                {footerPlaylistAddState === "added" ? (
                  <div className="favouriteSavedToast playlistActionToast" role="status" aria-live="polite">Added to playlist</div>
                ) : null}
                {footerPlaylistAddState === "error" ? (
                  <div className="favouriteSavedToast favouriteSavedToastError playlistActionToast" role="status" aria-live="polite">Could not add</div>
                ) : null}
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
              aria-label="Next track"
              title="Next track"
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
            {isLoggedIn ? (
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
            ) : null}
            {isDockedNewRoute ? (
              <button
                type="button"
                className="primaryActionToggleButton primaryActionDockedNextButton"
                onClick={handleDockedNewRouteNextTrack}
                disabled={footerActionsBlocked || routeAutoplayQueueIds.length === 0}
                aria-label="Next track in New"
                title="Next track in New"
              >
                <span className="primaryNavGlyph" aria-hidden="true">⇥</span>
              </button>
            ) : null}
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
          </div>
        </>
      );
    }
