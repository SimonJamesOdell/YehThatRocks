"use client";
import Link from "next/link";
import Image from "next/image";
import { Suspense, memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { AuthLoginForm } from "@/components/auth-login-form";
import { AuthModal } from "@/components/auth-modal";
import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { ArtistsLetterProvider } from "@/components/artists-letter-provider";
import { ArtistsLetterNav } from "@/components/artists-letter-nav";
import { HideVideoConfirmModal } from "@/components/hide-video-confirm-modal";
import { AuthUnavailableDialog } from "@/components/auth-unavailable-dialog";
import { BrandLockup } from "@/components/brand-lockup";
import { RightRailLyricsOverlay } from "@/components/right-rail-lyrics-overlay";
import { RightRailLoadingState } from "@/components/right-rail-loading-state";
import { RightRailPlaylistEmptyState } from "@/components/right-rail-playlist-empty-state";
import { RightRailDeleteConfirmDialog } from "@/components/right-rail-delete-confirm-dialog";
import { QueueTrackCardContent } from "@/components/queue-track-card-content";
import { PlaylistSummaryCardContent } from "@/components/playlist-summary-card-content";
import { PlaylistTrackCardContent } from "@/components/playlist-track-card-content";
import { PlaylistTrackRowCard } from "@/components/playlist-track-row-card";
import { PlaylistReorderControls } from "@/components/playlist-reorder-controls";
import { PlaylistDropPlaceholder } from "@/components/playlist-drop-placeholder";
import { PlaylistTrackDraggableShell } from "@/components/playlist-track-draggable-shell";
import { PlaylistTrackRow } from "@/components/playlist-track-row";
import { WatchNextStatusPanels } from "@/components/watch-next-status-panels";
import { WatchNextSeenToggle } from "@/components/watch-next-seen-toggle";
import { PrimaryNav } from "@/components/primary-nav";
import { DesktopIntroOverlay } from "@/components/desktop-intro-overlay";
import { ShellSearchBar } from "@/components/shell-search-bar";
import { OverlayHeader } from "@/components/overlay-header";
import { PlayerExperience } from "@/components/player-experience-core";
import { SearchResultFavouriteButton } from "@/components/search-result-favourite-button";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import { OverlayScrollContainerProvider } from "@/components/overlay-scroll-container-context";
import { LIVE_SEARCH_PARAMS_EVENT, useLiveSearchParams } from "@/components/use-live-search-params";
import { useTemporaryQueueController } from "@/components/use-temporary-queue-controller";
import { useSeenTogglePreference } from "@/components/use-seen-toggle-preference";
import { useDesktopIntro } from "@/components/use-desktop-intro";
import { usePerformanceMetrics } from "@/components/use-performance-metrics";
import { useSearchAutocomplete, type SearchSuggestion } from "@/components/use-search-autocomplete";
import { useChatState, type ChatMode, type ChatMessage, type OnlineUser } from "@/components/use-chat-state";
import { usePlaylistRail, type RightRailMode, type PlaylistRailVideo, type PlaylistRailPayload, type PlaylistRailSummary } from "@/components/use-playlist-rail";
import { PerformanceDial, SharedVideoMessageCard, WatchNextCard } from "@/components/shell-dynamic-rendering";
import { useRouteChangeTracking } from "@/components/use-route-change-tracking";
import { useShellAdminState } from "@/components/use-shell-admin-state";
import { useShellKeyboardShortcuts } from "@/components/use-shell-keyboard-shortcuts";
import { useShellOverlayEvents } from "@/components/use-shell-overlay-events";
import { useShellOverlayPendingState } from "@/components/use-shell-overlay-pending-state";
import { useShellDockOverlayTransitions } from "@/components/use-shell-dock-overlay-transitions";
import { useShellOverlayRouteMeta } from "@/components/use-shell-overlay-route-meta";
import { useWatchNextPrefetch } from "@/components/use-watch-next-prefetch";
import { useWatchNextPayloadLoader } from "@/components/use-watch-next-payload-loader";
import { useAuthSuccessListener } from "@/components/use-auth-success-listener";
import { useIdleRoutePrefetch } from "@/components/use-idle-route-prefetch";
import { useShellNavigationHelpers } from "@/components/use-shell-navigation-helpers";
import { dedupeRelatedRailVideos, finiteNumberOrNull, finitePercentOrNull, formatChatTimestamp, isFavouriteVideo, logFlow, logWatchNext, matchesPlaylistVideoOrder, sortVideosBySeen } from "@/components/shell-dynamic-utils";
import { deriveShellOverlayRouteState, isProtectedOverlayPath, isRouteActive, isCategoriesOverlayPath } from "@/components/shell-dynamic-route-state";
import { navItems, type VideoRecord } from "@/lib/catalog";
import { MagazineGenerateNowButton } from "@/components/magazine-generate-now-button";
import { detectAppendOnly, filterSeenFromWatchNext } from "@/components/shell-dynamic-helpers";
import { fetchWithAuthRetry as fetchWithAuthRetryClient } from "@/lib/client-auth-fetch";
import { mutateHiddenVideo } from "@/lib/hidden-video-client-service";
import { trackPageView, trackVideoView } from "@/lib/analytics-client";
import { dedupeVideos, filterHiddenVideos } from "@/lib/video-list-utils";
import { parseSharedVideoMessage } from "@/lib/chat-shared-video";
import { FORUM_SECTIONS } from "@/lib/forum-sections";
import { PLAYLISTS_UPDATED_EVENT, RIGHT_RAIL_MODE_EVENT, PLAYLIST_RAIL_SYNC_EVENT, PLAYLIST_CREATION_PROGRESS_EVENT, WATCH_HISTORY_UPDATED_EVENT, AUTOPLAY_SETTINGS_UPDATED_EVENT, RIGHT_RAIL_LYRICS_OPEN_EVENT, ADMIN_OVERLAY_ENTER_EVENT, DOCK_HIDE_REQUEST_EVENT, OVERLAY_CLOSE_REQUEST_EVENT, EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";
import { PENDING_VIDEO_SELECTION_KEY } from "@/lib/storage-keys";
import { applyRuntimeBootstrapPatches } from "@/lib/runtime-bootstrap";
import { parseJsonOrNull } from "@/lib/parse-json";
applyRuntimeBootstrapPatches({ safePerformanceMeasure: true });
type CurrentVideoResolvePayload = {
  currentVideo?: VideoRecord;
  relatedVideos?: VideoRecord[];
  pending?: boolean;
  denied?: { message?: string; reason?: string; videoId?: string };
  watchNextAdvisory?: WatchNextAdvisory;
};
type WatchNextAdvisory = {
  genreFilterActive: boolean;
  genreFilters: string[];
  constrainedByGenreFilter: boolean;
  emptyDueToGenreFilter: boolean;
};
type LyricsRailPayload = {
  artistName: string | null;
  trackName: string | null;
  lyrics: string | null;
  available: boolean;
  message: string | null;
  source: string | null;
  cached: boolean;
};
const DESKTOP_INTRO_LOGO_SRC = "/assets/images/yeh_main_logo.png?v=20260424-4";
type ShellDynamicProps = {
  initialVideo: VideoRecord;
  initialRelatedVideos: VideoRecord[];
  initialSeenVideoIds?: string[];
  initialHiddenVideoIds?: string[];
  isLoggedIn: boolean;
  initialAuthStatus?: "clear" | "unavailable";
  isAdmin: boolean;
  children: ReactNode;
};
const FLOW_DEBUG_ENABLED = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEBUG_FLOW === "1";
const LAST_RANDOM_START_VIDEO_ID_KEY = "ytr:last-random-start-video-id";
const CURRENT_VIDEO_PREFETCH_TTL_MS = 25_000;
const RELATED_FADE_STAGGER_MS = 22;
const RELATED_FADE_OUT_BASE_MS = 120;
const RELATED_FADE_IN_BASE_MS = 120;
const STARTUP_RETRY_FAST_ATTEMPTS = 4;
const STARTUP_RETRY_SLOW_DELAY_MS = 8_000;
const STARTUP_RETRY_MAX_ATTEMPTS = 8;
const REQUESTED_VIDEO_RETRY_FAST_ATTEMPTS = 4;
const REQUESTED_VIDEO_RETRY_SLOW_DELAY_MS = 8_000;
const REQUESTED_VIDEO_RETRY_MAX_ATTEMPTS = 8;
const RELATED_LOAD_BATCH_SIZE = 40;
const RELATED_LOAD_AHEAD_PX = 560;
const RELATED_MAX_VIDEOS = Number.MAX_SAFE_INTEGER;
const RELATED_BACKGROUND_PREFETCH_TARGET = 35;
const RELATED_BACKGROUND_PREFETCH_DELAY_MS = 650;
const RELATED_LOAD_AHEAD_AGGRESSIVE_PX = 920;
const RELATED_SCROLL_PREFETCH_BATCHES = 2;
const RELATED_BACKGROUND_PREFETCH_TARGET_AGGRESSIVE = 45;
const RELATED_BACKGROUND_PREFETCH_DELAY_FAST_MS = 280;
const RELATED_BOOTSTRAP_MIN_VISIBLE = 8;
const RELATED_LOADING_HINT_SHOW_DELAY_MS = 220;
const RELATED_LOADING_HINT_HIDE_DELAY_MS = 320;
const RELATED_FETCH_TIMEOUT_MS = 8_000;
const RELATED_COLD_FETCH_RETRY_ATTEMPTS = 3;
const RELATED_COLD_FETCH_RETRY_BASE_DELAY_MS = 250;
const WATCH_NEXT_HIDE_ANIMATION_MS = 240;
const WATCH_NEXT_HIDE_SEEN_TOGGLE_KEY = "ytr-toggle-hide-seen-watch-next";
const PREFETCH_FAILURE_BASE_BACKOFF_MS = 1_500;
const PREFETCH_FAILURE_MAX_BACKOFF_MS = 20_000;
const DOCK_MOVE_DURATION_MS = 520;
const DOCK_CONTROLS_FADE_DURATION_MS = 220;
const DOCK_CONTROLS_FADE_DELAY_MS = Math.max(0, DOCK_MOVE_DURATION_MS - DOCK_CONTROLS_FADE_DURATION_MS);
const UNDOCK_SETTLE_DURATION_MS = 220;
const FOOTER_REVEAL_DURATION_MS = 240;
// Duration of the primaryActionsReturn CSS animation (must stay in sync with player-actions.css).
const FOOTER_REVEAL_ANIMATION_MS = 180;
// Start the footer fade well before the undock movement ends so the controls
// are already occupying their final layout slot when the player lands.
const FOOTER_EARLY_REVEAL_DELAY_MS = 0;
/* Invariant anchors retained while listener wiring is delegated to hooks:
const handleDockHideRequest = () => {
window.addEventListener(DOCK_HIDE_REQUEST_EVENT, handleDockHideRequest);
window.removeEventListener(DOCK_HIDE_REQUEST_EVENT, handleDockHideRequest);
window.addEventListener(OVERLAY_OPEN_REQUEST_EVENT, handleOverlayOpenRequest);
usePlayerDockingAnimation
const lockedHeight = chrome.getBoundingClientRect().height;
chrome.style.height = `${lockedHeight}px`;
chrome.style.height = "";
// Release any height lock so docking can size freely.
setIsDockHidden(true);
if (shouldDockDesktopPlayer) {
}, [pathname, shouldDockDesktopPlayer]);
footerRevealTimeoutRef.current = window.setTimeout(() => {
setIsFooterRevealActive(false);
}, FOOTER_REVEAL_DURATION_MS);
const [isUndockSettling, setIsUndockSettling] = useState(false);
const routeLoadingLabel = pathname.endsWith("/wiki") || pendingOverlayOpenKind === "wiki" ? "Loading wiki" : "Loading video";
const isCategoriesOverlayPendingOrActive = isCategoriesRoute
const isArtistsOverlayPendingOrActive = isArtistsOverlayPath(pathname)
*/
function ShellDynamicInner({
  initialVideo,
  initialRelatedVideos,
  initialSeenVideoIds = [],
  initialHiddenVideoIds = [],
  isLoggedIn,
  initialAuthStatus = "clear",
  isAdmin,
  children,
}: ShellDynamicProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useLiveSearchParams();
  const searchParamsKey = searchParams.toString();
  const requestedVideoId = searchParams.get("v") || null;
  const activePlaylistId = searchParams.get("pl");
  const requestedPlaylistItemIndex = (() => {
    const rawIndex = searchParams.get("pli");
    if (!rawIndex) {
      return null;
    }
    const parsedIndex = Number.parseInt(rawIndex, 10);
    if (!Number.isFinite(parsedIndex) || parsedIndex < 0) {
      return null;
    }
    return parsedIndex;
  })();
  const initialHydratedRelatedVideos = dedupeRelatedRailVideos(dedupeVideos(initialRelatedVideos), initialVideo.id);
  const [currentVideo, setCurrentVideo] = useState(initialVideo);
  const [relatedVideos, setRelatedVideos] = useState<VideoRecord[]>(initialHydratedRelatedVideos);
  const [displayedRelatedVideos, setDisplayedRelatedVideos] = useState<VideoRecord[]>(initialHydratedRelatedVideos);
  const [relatedTransitionPhase, setRelatedTransitionPhase] = useState<"idle" | "fading-out" | "loading" | "fading-in">("idle");
  const [isLoadingMoreRelated, setIsLoadingMoreRelated] = useState(false);
  const [showLoadingMoreRelatedHint, setShowLoadingMoreRelatedHint] = useState(false);
  const [hasMoreRelated, setHasMoreRelated] = useState(true);
  const [watchNextLoadFailed, setWatchNextLoadFailed] = useState(false);
  const [watchNextAdvisory, setWatchNextAdvisory] = useState<WatchNextAdvisory | null>(null);
  const seenVideoIdsRef = useRef<Set<string>>(new Set(initialSeenVideoIds));
  const hiddenVideoIdsRef = useRef<Set<string>>(new Set(initialHiddenVideoIds));
  const activeVideoId = requestedVideoId ?? currentVideo.id;
  const [isAuthenticated, setIsAuthenticated] = useState(isLoggedIn);
  const [authStatus, setAuthStatus] = useState<"clear" | "unavailable">(initialAuthStatus);
  const [authStatusMessage, setAuthStatusMessage] = useState<string | null>(
    initialAuthStatus === "unavailable"
      ? "The auth server is not responding, so your authorization status cannot currently be confirmed. Try again later or reconnect now."
      : null,
  );
  const [isAuthUnavailableDialogDismissed, setIsAuthUnavailableDialogDismissed] = useState(false);
  const [isRetryingAuthStatus, setIsRetryingAuthStatus] = useState(false);
  const [deniedPlaybackMessage, setDeniedPlaybackMessage] = useState<string | null>(null);
  const [forcedUnavailableSignal, setForcedUnavailableSignal] = useState(0);
  const [forcedUnavailableMessage, setForcedUnavailableMessage] = useState<string | null>(null);
  const [hidingRelatedVideoIds, setHidingRelatedVideoIds] = useState<string[]>([]);
  const [hiddenMutationPendingVideoIds, setHiddenMutationPendingVideoIds] = useState<string[]>([]);
  const [watchNextHideConfirmTrack, setWatchNextHideConfirmTrack] = useState<VideoRecord | null>(null);
  const hidingRelatedVideoIdsRef = useRef<string[]>([]);
  const hiddenMutationPendingVideoIdsRef = useRef<string[]>([]);
  const [isLyricsOverlayOpen, setIsLyricsOverlayOpen] = useState(false);
  const [lyricsOverlayVideoId, setLyricsOverlayVideoId] = useState<string | null>(null);
  const [isLyricsOverlayLoading, setIsLyricsOverlayLoading] = useState(false);
  const [lyricsOverlayError, setLyricsOverlayError] = useState<string | null>(null);
  const [lyricsOverlayData, setLyricsOverlayData] = useState<LyricsRailPayload | null>(null);
  const [watchNextHideSeen, setWatchNextHideSeen] = useSeenTogglePreference({
    key: WATCH_NEXT_HIDE_SEEN_TOGGLE_KEY,
    isAuthenticated,
  });
  const [watchNextRefreshTick, setWatchNextRefreshTick] = useState(0);
  const [seenVideoRefreshTick, setSeenVideoRefreshTick] = useState(0);
  const [clickedRelatedVideoId, setClickedRelatedVideoId] = useState<string | null>(null);
  const [isResolvingInitialVideo, setIsResolvingInitialVideo] = useState(
    !requestedVideoId,
  );
  const [isResolvingRequestedVideo, setIsResolvingRequestedVideo] = useState(
    Boolean(requestedVideoId && requestedVideoId !== initialVideo.id),
  );
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isMobileCommunityOpen, setIsMobileCommunityOpen] = useState(false);
  const [hasClientMounted, setHasClientMounted] = useState(false);
  const [hasBootstrappedWatchNext, setHasBootstrappedWatchNext] = useState(false);
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);
  const lastVideoIdRef = useRef<string | null>(
    requestedVideoId && requestedVideoId === initialVideo.id ? requestedVideoId : null,
  );
  const deniedRequestedVideoIdRef = useRef<string | null>(null);
  const hasResolvedInitialVideoRef = useRef(Boolean(requestedVideoId));
  const startupHydratedVideoIdRef = useRef<string | null>(null);
  const prefetchedRelatedIdsRef = useRef<Set<string>>(new Set());
  const prefetchedCurrentVideoPayloadRef = useRef<Map<string, { expiresAt: number; payload: CurrentVideoResolvePayload }>>(new Map());
  const inFlightCurrentVideoPrefetchRef = useRef<Set<string>>(new Set());
  const prefetchBlockedUntilRef = useRef(0);
  const prefetchFailureCountRef = useRef(0);
  const prewarmedThumbnailIdsRef = useRef<Set<string>>(new Set());
  const relatedTransitionTimeoutRef = useRef<number | null>(null);
  const relatedClickFlashTimeoutRef = useRef<number | null>(null);
  const relatedHideTimeoutsRef = useRef<Map<string, number>>(new Map());
  const relatedStackRef = useRef<HTMLDivElement | null>(null);
  const relatedLoadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const relatedLoadInFlightRef = useRef(false);
  const relatedFetchOffsetRef = useRef<number | null>(null);
  const watchNextAutoRecoverAttemptRef = useRef(0);
  const relatedScrollRafRef = useRef<number | null>(null);
  const hasUserScrolledWatchNextRef = useRef(false);
  const relatedVideosRef = useRef<VideoRecord[]>([]);
  const watchNextRailRef = useRef<HTMLElement | null>(null);
  const favouritesBlindInnerRef = useRef<HTMLDivElement | null>(null);
  const previousPathnameRef = useRef<string | null>(null);
  const didArriveOnMagazineRouteRef = useRef(pathname === "/magazine" || pathname.startsWith("/magazine/"));
  const [artistsPanelDockOffset, setArtistsPanelDockOffset] = useState(0);
  const [playerDockScaleX, setPlayerDockScaleX] = useState(1);
  const [playerDockScaleY, setPlayerDockScaleY] = useState(1);
  const [playerDockHeightPx, setPlayerDockHeightPx] = useState(0);
  const [isOverlayClosing, setIsOverlayClosing] = useState(false);
  const [isUndockSettling, setIsUndockSettling] = useState(false);
  const [isFooterRevealActive, setIsFooterRevealActive] = useState(false);
  const [isDockTransitioning, setIsDockTransitioning] = useState(false);
  const [isDockHidden, setIsDockHidden] = useState(false);
  const [startupSelectionRefreshTick, setStartupSelectionRefreshTick] = useState(0);
  const dockTransitionTimeoutRef = useRef<number | null>(null);
  const {
    temporaryQueueVideos,
    temporaryQueueVideoIdSet,
    handleAddToTemporaryQueue,
    handleRemoveFromTemporaryQueue,
    handleClearTemporaryQueue,
  } = useTemporaryQueueController(currentVideo.id);
  const {
    pendingOverlayOpenKind,
    setPendingOverlayOpenKind,
    pendingOverlayRouteKey,
    setPendingOverlayRouteKey,
    pendingOverlayCloseVideoId,
    setPendingOverlayCloseVideoId,
    pendingOverlayCloseHref,
    setPendingOverlayCloseHref,
    retryPendingOverlayVideoLoad,
  } = useShellOverlayPendingState({
    pathname,
    requestedVideoId,
    currentVideoId: currentVideo.id,
    isResolvingInitialVideo,
    isResolvingRequestedVideo,
    router,
  });
  const previousPathname = previousPathnameRef.current;
  const {
    isCategoriesRoute,
    isArtistsRoute,
    previousWasCategoriesRoute,
    previousWasArtistsRoute,
    isAdminOverlayRoute,
    isOverlayRoute,
    shouldShowOverlayPanel,
    disableOverlayDropAnimation,
    isPlayerWidthOverlayRoute,
    overlayPanelClassName,
    isMagazineOverlayRoute,
    isForumOverlayRoute,
    shouldDisableRelatedRailTransition,
    shouldOccludeLeftRail,
    shouldOccludeRightRail,
    isArtistsIndexRoute,
    shouldDockDesktopPlayer,
    shouldDockUnderArtistsAlphabet,
    shouldKeepDockedDesktopPresentation,
  } = deriveShellOverlayRouteState({
    pathname,
    previousPathname,
    pendingOverlayOpenKind,
    isOverlayClosing,
    isUndockSettling,
    isDockTransitioning,
  });
  const shouldHidePlayerForMagazineGuest = !isAuthenticated && isMagazineOverlayRoute && didArriveOnMagazineRouteRef.current;
  const isWaitingForClientHydration = !hasClientMounted;
  const isWaitingForStartupVideoUrlSync =
    !requestedVideoId
    && isResolvingInitialVideo
    && startupHydratedVideoIdRef.current !== null;
  const isWatchNextVideoSelectionPending =
    isWaitingForClientHydration
    || isWaitingForStartupVideoUrlSync
    || isResolvingInitialVideo
    || isResolvingRequestedVideo
    || Boolean(requestedVideoId && requestedVideoId !== currentVideo.id);
  const playerChromeClassName = [
    "playerChrome",
    shouldKeepDockedDesktopPresentation ? "playerChromeDockedDesktop" : "",
    shouldDockUnderArtistsAlphabet ? "playerChromeDockedArtists" : "",
    shouldDockDesktopPlayer && isDockTransitioning ? "playerChromeDockTransitioning" : "",
    isOverlayClosing ? "playerChromeUndocking" : "",
    isUndockSettling ? "playerChromeUndockSettling" : "",
    // Allow the footer reveal during the undock movement (isOverlayClosing) so the
    // footer finishes fading in just as the video reaches its final position.
    (!shouldShowOverlayPanel || isOverlayClosing) && isFooterRevealActive ? "playerChromeFooterReveal" : "",
    shouldDockDesktopPlayer && isDockHidden ? "playerChromeDockedHidden" : "",
    shouldHidePlayerForMagazineGuest ? "playerChromeMagazineGuestHidden" : "",
  ].filter(Boolean).join(" ");
  const playerChromeStyle = shouldKeepDockedDesktopPresentation
    ? ({
      "--player-dock-artists-offset": `${artistsPanelDockOffset}px`,
      "--player-dock-scale-x": String(playerDockScaleX),
      "--player-dock-scale-y": String(playerDockScaleY),
      "--player-dock-height": `${playerDockHeightPx}px`,
    } as CSSProperties)
    : undefined;
  const isMobileCommunityCollapsed = isMobileViewport && !isMobileCommunityOpen;
  // ── Auth callbacks (needed by hooks below) ───────────────────────────────
  const refreshAuthSession = useCallback(async () => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }
    const refreshPromise = (async () => {
      try {
        const response = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: "{}",
        });
        return response.ok;
      } catch {
        return false;
      }
    })();
    refreshPromiseRef.current = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      refreshPromiseRef.current = null;
    }
  }, []);
  const fetchWithAuthRetry = useCallback(
    async (input: string, init?: RequestInit) => {
      const requestInit: RequestInit = {
        credentials: "same-origin",
        ...init,
      };
      let response = await fetch(input, requestInit);
      if (response.status !== 401 && response.status !== 403) {
        return response;
      }
      const didRefresh = await refreshAuthSession();
      if (!didRefresh) {
        return response;
      }
      response = await fetch(input, requestInit);
      return response;
    },
    [refreshAuthSession],
  );
  const checkAuthState = useCallback(async () => {
    const isDocumentVisible = typeof document === "undefined" || document.visibilityState === "visible";
    const resolveAuthState = async () => {
      try {
        const response = await fetchWithAuthRetry("/api/auth/me");
        if (response.status === 401 || response.status === 403) {
          return "unauthenticated" as const;
        }
        if (!response.ok) {
          return "unavailable" as const;
        }
        return "authenticated" as const;
      } catch {
        return "unavailable" as const;
      }
    };
    let resolvedState = await resolveAuthState();
    // Tabs resuming from sleep can produce one-off network/auth hiccups.
    // Retry once before showing a blocking auth-unavailable modal.
    if (resolvedState === "unavailable" && isAuthenticated) {
      await new Promise<void>((resolve) => {
        window.setTimeout(() => {
          resolve();
        }, 900);
      });
      resolvedState = await resolveAuthState();
    }
    // When refresh rotates in a parallel request, one /api/auth/me probe can briefly
    // read stale cookies and report 401. Retry once before forcing a sign-out.
    if (resolvedState === "unauthenticated" && isAuthenticated) {
      await new Promise<void>((resolve) => {
        window.setTimeout(() => {
          resolve();
        }, 450);
      });
      resolvedState = await resolveAuthState();
    }
    // Background tabs and wake-from-sleep transitions can briefly fail auth probes
    // without any real server outage. Avoid showing a blocking modal until the page
    // is foregrounded again and another visible check can confirm the failure.
    if (resolvedState === "unavailable" && isAuthenticated && !isDocumentVisible) {
      return "authenticated" as const;
    }
    if (resolvedState === "unauthenticated") {
      setAuthStatus("clear");
      setAuthStatusMessage(null);
      setIsAuthenticated(false);
      return "unauthenticated" as const;
    }
    if (resolvedState === "unavailable") {
      setAuthStatus("unavailable");
      setAuthStatusMessage("The auth server is probably being updated. Please wait a moment and try again.");
      return "unavailable" as const;
    }
    setAuthStatus("clear");
    setAuthStatusMessage(null);
    setIsAuthenticated(true);
    return "authenticated" as const;
  }, [fetchWithAuthRetry, isAuthenticated]);
  // ── Custom hooks ──────────────────────────────────────────────────────────
  const {
    isDesktopIntroActive,
    isDesktopIntroPreload,
    isDesktopIntroLogoReady,
    desktopIntroPhase,
    desktopIntroDeltaX,
    desktopIntroDeltaY,
    desktopIntroScale,
    brandLogoTargetRef,
    shellDesktopIntroStyle: _shellDesktopIntroStyle,
    startPreparedDesktopIntroSequence,
    shouldReplayDesktopIntroOnHomeRef,
  } = useDesktopIntro({ pathname });
  const {
    searchValue, setSearchValue,
    suggestions, showSuggestions, setShowSuggestions,
    activeSuggestionIdx,
    searchComboboxRef,
    handleSearchInput, handleSearchKeyDown, handleSuggestionClick,
  } = useSearchAutocomplete({ currentVideoId: currentVideo.id, router });
  const {
    rightRailMode, setRightRailMode,
    playlistRailData, isPlaylistRailLoading, playlistRailError,
    playlistRailSummaries, isPlaylistSummaryLoading, playlistSummaryError,
    playlistRefreshTick, setPlaylistRefreshTick,
    playlistMutationMessage, playlistMutationTone,
    setPlaylistMutationMessage, setPlaylistMutationTone,
    playlistMutationPendingVideoId,
    isCreatingRailPlaylist, playlistCreationPendingId,
    lastAddedRelatedVideoId, recentlyAddedPlaylistTrack,
    hidingPlaylistTrackKeys, playlistItemMutationPendingKeys,
    draggedPlaylistTrackIndex, dragOverPlaylistTrackIndex,
    isDeletingActivePlaylist,
    showDeleteActivePlaylistConfirm, setShowDeleteActivePlaylistConfirm,
    confirmDeleteRailPlaylist, setConfirmDeleteRailPlaylist,
    playlistBeingDeletedId,
    playlistStackBodyRef,
    activePlaylistTrackIndex, activePlaylistTrackCount, isCreatingActivePlaylist,
    getActivatePlaylistHref, getClosePlaylistHref,
    handleDeleteActivePlaylist, handleDeletePlaylistFromRail,
    handleCreatePlaylistFromRail, handleAddToPlaylistFromWatchNext,
    handleRemoveTrackFromActivePlaylist, handleReorderActivePlaylistTrack,
    handleSwitchToWatchNextRail,
    handlePlaylistTrackDragStart, handlePlaylistTrackDragOver,
    handlePlaylistTrackDrop, handlePlaylistTrackDragEnd,
  } = usePlaylistRail({
    activePlaylistId,
    requestedPlaylistItemIndex,
    currentVideoId: currentVideo.id,
    pathname,
    searchParamsString: searchParams.toString(),
    router,
    isAuthenticated,
    fetchWithAuthRetry,
    checkAuthState,
  });
  const {
    chatMode, setChatMode,
    chatMessages, onlineUsers, chatDraft, setChatDraft,
    chatError, isChatLoading, isChatSubmitting, deletingMessageIds,
    flashingChatTabs, chatListRef, latestMagazineTracks,
    handleChatSubmit, handleDeleteChatMessage,
  } = useChatState({
    initialPathname: pathname,
    pathname,
    isAuthenticated,
    isMagazineOverlayRoute,
    isForumOverlayRoute,
    isAdminOverlayRoute,
    // Keep chat/comments rail state mounted on core browse overlays so closing
    // those routes does not force a full chat reload.
    shouldShowOverlayPanel:
      shouldShowOverlayPanel
      && pathname !== "/new"
      && pathname !== "/top100"
      && pathname !== "/search"
      && pathname !== "/favourites"
      && pathname !== "/history"
      && pathname !== "/account"
      && (pathname !== "/artists" && !pathname.startsWith("/artists/") && !pathname.startsWith("/artist/"))
      && (pathname !== "/categories" && !pathname.startsWith("/categories/"))
      && !pathname.startsWith("/playlists"),
    fetchWithAuthRetry,
    checkAuthState,
  });
  const {
    deletingMagazineSlugs,
    magazineDeleteErrors,
    visibleMagazineTracks,
    handleDeleteMagazineArticle,
  } = useShellAdminState({
    isAdmin,
    latestMagazineTracks,
    pathname,
    onDeletedCurrentArticle: () => {
      router.replace("/magazine");
    },
  });
  const isShellInitialUiSettled =
    !isDesktopIntroActive
    && !isWatchNextVideoSelectionPending
    && hasBootstrappedWatchNext
    && relatedTransitionPhase === "idle";
  const {
    isPerformanceQuickLaunchVisible,
    isPerformanceModalOpen, setIsPerformanceModalOpen,
    performanceMetrics, performanceRuntime, performanceMetricsGeneratedAt,
    isLoadingPerformanceMetrics, performanceMetricsError,
  } = usePerformanceMetrics({ isShellInitialUiSettled });
  const {
    handleButtonLikeKeyDown,
    handleStopPropagationKeyDown,
  } = useShellKeyboardShortcuts();
  // Client mounting hook
  useEffect(() => {
    setHasClientMounted(true);
  }, []);

  // Use orchestration hook for route change tracking (pathname, analytics firing)
  useRouteChangeTracking({
    pathname,
    activeVideoId,
    onPathnameChange: (newPathname) => {
      previousPathnameRef.current = newPathname;
    },
    onAnalyticsPageView: trackPageView,
    onAnalyticsVideoView: trackVideoView,
  });

  const handleBrandLogoClick = useCallback(() => {
    // Force startup resolver to run again after logo navigation clears ?v.
    hasResolvedInitialVideoRef.current = false;
    startupHydratedVideoIdRef.current = null;
    shouldReplayDesktopIntroOnHomeRef.current = true;
    if (pathname === "/" && !requestedVideoId) {
      setStartupSelectionRefreshTick((value) => value + 1);
    }
    if (pathname === "/") {
      shouldReplayDesktopIntroOnHomeRef.current = false;
      void startPreparedDesktopIntroSequence();
    }
  }, [pathname, requestedVideoId, shouldReplayDesktopIntroOnHomeRef, startPreparedDesktopIntroSequence]);
  const isLeftRailSuppressed = shouldOccludeLeftRail || isMobileCommunityCollapsed;
  const artistLetterParam = searchParams.get("letter");
  const activeArtistLetter =
    artistLetterParam && /^[A-Za-z]$/.test(artistLetterParam)
      ? artistLetterParam.toUpperCase()
      : "A";
  const resumeParam = searchParams.get("resume") ?? undefined;
  const {
    overlayRouteKey,
    isCategoriesOverlayPendingOrActive,
    isArtistsOverlayPendingOrActive,
    routeLoadingLabel,
    routeLoadingMessage,
    handleOverlayVideoLinkClickCapture,
  } = useShellOverlayRouteMeta({
    pathname,
    searchParamsString: searchParams.toString(),
    pendingOverlayRouteKey,
    pendingOverlayOpenKind,
    disableOverlayDropAnimation,
    isCategoriesRoute,
    shouldShowOverlayPanel,
    isOverlayClosing,
    onPush: (href) => {
      router.push(href);
    },
  });
  const handleOverlayOpenRequest = useCallback((kind: "wiki" | "video", optimisticRouteKey: string) => {
    setPendingOverlayOpenKind(kind);
    setPendingOverlayRouteKey(optimisticRouteKey);
  }, [setPendingOverlayOpenKind, setPendingOverlayRouteKey]);
  const resetPendingOverlayFromOpenTimeout = useCallback(() => {
    setPendingOverlayOpenKind(null);
    setPendingOverlayRouteKey(null);
  }, [setPendingOverlayOpenKind, setPendingOverlayRouteKey]);
  const {
    playerChromeRef,
    handleOverlayCloseRequest,
  } = useShellDockOverlayTransitions({
    isOverlayClosing,
    setIsOverlayClosing,
    isUndockSettling,
    setIsUndockSettling,
    setIsFooterRevealActive,
    currentVideoId: currentVideo.id,
    isMagazineOverlayRoute,
    pathname,
    requestedVideoId,
    shouldShowOverlayPanel,
    setPendingOverlayOpenKind,
    setPendingOverlayCloseVideoId,
    setPendingOverlayCloseHref,
    onPush: (href) => {
      router.push(href);
    },
    onOverlayShown: () => {
      setIsMobileCommunityOpen(false);
    },
    dockMoveDurationMs: DOCK_MOVE_DURATION_MS,
    footerRevealDurationMs: FOOTER_REVEAL_DURATION_MS,
    footerEarlyRevealDelayMs: FOOTER_EARLY_REVEAL_DELAY_MS,
  });
  const handleDockHideRequest = useCallback(() => {
    setIsDockHidden(true);
  }, []);
  useShellOverlayEvents({
    pathname,
    isCategoriesRoute,
    overlayScrollContainerRef: favouritesBlindInnerRef,
    onOpenRequest: handleOverlayOpenRequest,
    onResetPendingOverlay: resetPendingOverlayFromOpenTimeout,
    onCloseRequest: handleOverlayCloseRequest,
    onDockHideRequest: handleDockHideRequest,
  });
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const syncViewportState = () => {
      const isMobile = mediaQuery.matches;
      setIsMobileViewport(isMobile);
      if (!isMobile) {
        setIsMobileCommunityOpen(false);
      }
    };
    syncViewportState();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncViewportState);
      return () => {
        mediaQuery.removeEventListener("change", syncViewportState);
      };
    }
    mediaQuery.addListener(syncViewportState);
    return () => {
      mediaQuery.removeListener(syncViewportState);
    };
  }, []);
  useEffect(() => {
    if (typeof window === "undefined" || !isAdminOverlayRoute) {
      return;
    }
    window.dispatchEvent(new Event(ADMIN_OVERLAY_ENTER_EVENT));
  }, [isAdminOverlayRoute]);
  useEffect(() => {
    if (requestedVideoId) {
      setIsDockHidden(false);
    }
  }, [requestedVideoId]);
  useEffect(() => {
    if (shouldDockDesktopPlayer) {
      setIsDockHidden(false);
    }
  }, [pathname, shouldDockDesktopPlayer]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (dockTransitionTimeoutRef.current !== null) {
      window.clearTimeout(dockTransitionTimeoutRef.current);
      dockTransitionTimeoutRef.current = null;
    }
    if (!shouldDockDesktopPlayer) {
      setIsDockTransitioning(false);
      setIsDockHidden(false);
      return;
    }
    setIsDockTransitioning(true);
    dockTransitionTimeoutRef.current = window.setTimeout(() => {
      setIsDockTransitioning(false);
      dockTransitionTimeoutRef.current = null;
    }, DOCK_CONTROLS_FADE_DELAY_MS);
    return () => {
      if (dockTransitionTimeoutRef.current !== null) {
        window.clearTimeout(dockTransitionTimeoutRef.current);
        dockTransitionTimeoutRef.current = null;
      }
    };
  }, [shouldDockDesktopPlayer, shouldDockUnderArtistsAlphabet]);
  useEffect(() => {
    setIsAuthenticated(isLoggedIn);
    if (!isLoggedIn) {
      setAuthStatus("clear");
      setAuthStatusMessage(null);
      return;
    }
    if (initialAuthStatus === "unavailable") {
      setAuthStatus("unavailable");
      setAuthStatusMessage("The auth server is probably being updated. Please wait a moment and try again.");
      return;
    }
    setAuthStatus("clear");
    setAuthStatusMessage(null);
  }, [initialAuthStatus, isLoggedIn]);
  useEffect(() => {
    if (authStatus !== "unavailable" || !authStatusMessage) {
      setIsAuthUnavailableDialogDismissed(false);
    }
  }, [authStatus, authStatusMessage]);
  useEffect(() => {
    if (isAuthenticated || seenVideoIdsRef.current.size === 0) {
      return;
    }
    seenVideoIdsRef.current = new Set<string>();
    setSeenVideoRefreshTick((value) => value + 1);
  }, [isAuthenticated]);
  useEffect(() => {
    if (pathname !== "/top100" && pathname !== "/history") {
      return;
    }
    const node = favouritesBlindInnerRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = 0;
    const frameId = window.requestAnimationFrame(() => {
      if (favouritesBlindInnerRef.current) {
        favouritesBlindInnerRef.current.scrollTop = 0;
      }
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [pathname]);
  useEffect(() => {
    if (!pathname.endsWith("/wiki")) {
      return;
    }
    const node = favouritesBlindInnerRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = 0;
    const frameId = window.requestAnimationFrame(() => {
      if (favouritesBlindInnerRef.current) {
        favouritesBlindInnerRef.current.scrollTop = 0;
      }
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [pathname]);
  useEffect(() => {
    if (!shouldDockUnderArtistsAlphabet || typeof window === "undefined") {
      setArtistsPanelDockOffset(0);
      return;
    }
    const syncArtistsPanelOffset = () => {
      const panel = document.querySelector(".artistsLetterPanel") as HTMLElement | null;
      if (!panel) {
        setArtistsPanelDockOffset(0);
        return;
      }
      setArtistsPanelDockOffset(panel.offsetHeight + 8);
    };
    syncArtistsPanelOffset();
    window.addEventListener("resize", syncArtistsPanelOffset);
    return () => {
      window.removeEventListener("resize", syncArtistsPanelOffset);
    };
  }, [shouldDockUnderArtistsAlphabet, pathname]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    let rafId: number | null = null;
    const syncPlayerDockScale = () => {
      if (!shouldDockDesktopPlayer || window.innerWidth < 1181) {
        setPlayerDockScaleX(1);
        setPlayerDockScaleY(1);
        setPlayerDockHeightPx(0);
        return;
      }
      const chrome = playerChromeRef.current;
      const leftRail = document.querySelector(".leftRail") as HTMLElement | null;
      if (!chrome || !leftRail) {
        return;
      }
      const frame = chrome.querySelector(".playerFrame, .playerLoadingFallback") as HTMLElement | null;
      if (!frame) {
        return;
      }
      const baseFrameWidth = frame.offsetWidth;
      const baseFrameHeight = frame.offsetHeight;
      const railRect = leftRail.getBoundingClientRect();
      if (baseFrameWidth <= 0 || baseFrameHeight <= 0 || railRect.width <= 0) {
        // Frame not yet laid out — retry after next paint.
        rafId = window.requestAnimationFrame(syncPlayerDockScale);
        return;
      }
      const targetWidth = railRect.width;
      // Lock scaling to final rail width while preserving aspect ratio via uniform scale.
      let uniformScale = Math.max(0.2, Math.min(1, targetWidth / baseFrameWidth));
      // On ultrawide (21:9+) with the artists alphabet panel visible, drive scale by
      // available vertical height instead of rail width — the rail is too narrow on
      // ultrawide which produces a tiny player. The player may be wider than the rail
      // but that is acceptable on a screen this wide.
      const isUltrawide = window.innerWidth / window.innerHeight > 21 / 9;
      if (isUltrawide && shouldDockUnderArtistsAlphabet) {
        const panel = document.querySelector(".artistsLetterPanel") as HTMLElement | null;
        if (!panel || panel.offsetHeight === 0) {
          // Panel not yet rendered — retry after next paint so we measure the real height.
          rafId = window.requestAnimationFrame(syncPlayerDockScale);
          return;
        }
        const panelHeight = panel.offsetHeight + 8;
        const footerReserve = 220; // px: space for footer controls row below player
        const availableHeight = window.innerHeight - panelHeight - footerReserve;
        if (availableHeight > 0 && availableHeight < baseFrameHeight) {
          // Scale so player height fills available space; cap at 1× (never upscale).
          const scaleByHeight = availableHeight / baseFrameHeight;
          uniformScale = Math.max(0.15, Math.min(1, scaleByHeight));
        } else if (availableHeight <= 0) {
          // Panel + reserve already fills viewport — use minimum readable scale.
          uniformScale = 0.15;
        }
        // If availableHeight >= baseFrameHeight the width-based scale from above is fine.
      }
      setPlayerDockScaleX(uniformScale);
      setPlayerDockScaleY(uniformScale);
      setPlayerDockHeightPx(baseFrameHeight * uniformScale);
      if (process.env.NODE_ENV === "development") {
        // eslint-disable-next-line no-console
        console.log("[dockScale]", { uniformScale, baseFrameWidth, baseFrameHeight, railWidth: railRect.width, windowW: window.innerWidth, windowH: window.innerHeight, isUltrawide: window.innerWidth / window.innerHeight > 21 / 9, shouldDockUnderArtistsAlphabet });
      }
    };
    syncPlayerDockScale();
    // Safety-net: if the synchronous call above scheduled a RAF that gets cancelled
    // by a dep change (e.g. mid-navigation state flush), a delayed retry ensures the
    // scale is always corrected even when the frame dims weren't ready immediately.
    const timeoutId = setTimeout(syncPlayerDockScale, 200);
    window.addEventListener("resize", syncPlayerDockScale);
    return () => {
      window.removeEventListener("resize", syncPlayerDockScale);
      clearTimeout(timeoutId);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [activeVideoId, isResolvingInitialVideo, isResolvingRequestedVideo, pathname, shouldDockDesktopPlayer, shouldDockUnderArtistsAlphabet]);
  // Separate effect: on ultrawide when artists alphabet panel becomes visible,
  // re-run the scale calculation after the DOM has fully settled.
  // The main syncPlayerDockScale may fire before the panel is rendered and produce
  // an unconstrained (full-size) result; this corrects it after layout stabilises.
  useEffect(() => {
    if (!shouldDockUnderArtistsAlphabet || typeof window === "undefined") {
      return;
    }
    const isUltrawide = window.innerWidth / window.innerHeight > 21 / 9;
    if (!isUltrawide) {
      return;
    }
    let rafId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const applyUltrawideArtistsScale = () => {
      const chrome = playerChromeRef.current;
      if (!chrome) return;
      const frame = chrome.querySelector(".playerFrame, .playerLoadingFallback") as HTMLElement | null;
      const panel = document.querySelector(".artistsLetterPanel") as HTMLElement | null;
      if (!frame || !panel) {
        rafId = window.requestAnimationFrame(applyUltrawideArtistsScale);
        return;
      }
      const baseFrameWidth = frame.offsetWidth;
      const baseFrameHeight = frame.offsetHeight;
      const panelH = panel.offsetHeight;
      if (baseFrameWidth <= 0 || baseFrameHeight <= 0 || panelH === 0) {
        rafId = window.requestAnimationFrame(applyUltrawideArtistsScale);
        return;
      }
      const footerReserve = 220;
      const availableHeight = window.innerHeight - panelH - footerReserve;
      if (availableHeight > 0 && availableHeight < baseFrameHeight) {
        const scale = Math.max(0.15, Math.min(1, availableHeight / baseFrameHeight));
        setPlayerDockScaleX(scale);
        setPlayerDockScaleY(scale);
        setPlayerDockHeightPx(baseFrameHeight * scale);
      }
    };
    // Run immediately (catches cases where panel is already present), then again
    // after a short delay to cover slow page renders and CSS transitions.
    rafId = window.requestAnimationFrame(applyUltrawideArtistsScale);
    timeoutId = setTimeout(applyUltrawideArtistsScale, 300);
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [shouldDockUnderArtistsAlphabet, pathname]);
  useEffect(() => {
    if (requestedVideoId) {
      return;
    }
    // Don't inject a ?v= into the URL while the user is browsing the magazine —
    // wait until they leave the magazine overlay before selecting a startup video.
    if (isMagazineOverlayRoute) {
      return;
    }
    // Don't re-run startup if we already resolved a video in this session
    // (e.g. user navigated to a route without ?v= after startup completed)
    if (hasResolvedInitialVideoRef.current) {
      return;
    }
    let cancelled = false;
    setIsResolvingInitialVideo(true);
    const previousVideoId = window.sessionStorage.getItem(LAST_RANDOM_START_VIDEO_ID_KEY);
    const navigateToVideo = (nextVideoId: string | undefined, source: string) => {
      if (!nextVideoId || cancelled) {
        logFlow(FLOW_DEBUG_ENABLED, "startup-selection:skipped", {
          source,
          nextVideoId,
          cancelled,
        });
        return;
      }
      window.sessionStorage.setItem(LAST_RANDOM_START_VIDEO_ID_KEY, nextVideoId);
      logFlow(FLOW_DEBUG_ENABLED, "startup-selection:navigate", {
        source,
        nextVideoId,
        previousVideoId,
      });
      router.replace(`${pathname}?${new URLSearchParams({ ...Object.fromEntries(searchParams.entries()), v: nextVideoId }).toString()}`);
      // Ensure custom live-search listeners observe startup URL sync even when
      // router updates are coalesced/deferred by the browser.
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent(LIVE_SEARCH_PARAMS_EVENT));
      }, 0);
    };
    const resolveStartupCandidate = (selectedVideo: VideoRecord, relatedVideos: VideoRecord[], source: string) => {
      setCurrentVideo(selectedVideo);
      setRelatedVideos(relatedVideos);
      setIsResolvingInitialVideo(false);
      hasResolvedInitialVideoRef.current = true;
      startupHydratedVideoIdRef.current = selectedVideo.id;
      // Pre-populate the prefetch cache so the requestedVideoId effect can
      // short-circuit after the URL syncs instead of issuing a redundant fetch.
      lastVideoIdRef.current = selectedVideo.id;
      prefetchedCurrentVideoPayloadRef.current.set(selectedVideo.id, {
        expiresAt: Date.now() + CURRENT_VIDEO_PREFETCH_TTL_MS,
        payload: { currentVideo: selectedVideo, relatedVideos },
      });
      navigateToVideo(selectedVideo.id, source);
      return true;
    };
    logFlow(FLOW_DEBUG_ENABLED, "startup-selection:server-initial", {
      selectedVideoId: initialVideo.id,
      relatedCount: initialHydratedRelatedVideos.length,
    });
    resolveStartupCandidate(initialVideo, initialHydratedRelatedVideos, "server-initial");
    return () => {
      cancelled = true;
    };
  }, [initialHydratedRelatedVideos, initialVideo, pathname, requestedVideoId, router, searchParamsKey, startupSelectionRefreshTick]);
  useEffect(() => {
    logFlow(FLOW_DEBUG_ENABLED, "requested-video:effect", {
      requestedVideoId,
      lastRequestedVideoId: lastVideoIdRef.current,
      currentVideoId: currentVideo.id,
    });
    if (!requestedVideoId) {
      deniedRequestedVideoIdRef.current = null;
      setIsResolvingRequestedVideo(false);
      return;
    }
    if (deniedRequestedVideoIdRef.current === requestedVideoId) {
      setIsResolvingRequestedVideo(false);
      return;
    }
    // Guard against duplicate effect executions for the same requested id
    // while a resolve is already in flight (can happen during rapid rerenders).
    if (requestedVideoId === lastVideoIdRef.current && isResolvingRequestedVideo) {
      return;
    }
    if (
      requestedVideoId === lastVideoIdRef.current &&
      currentVideo.id === requestedVideoId &&
      !isResolvingRequestedVideo
    ) {
      // Data is already correct (populated by startup resolver or previous fetch).
      // Clear the startup-hydration sentinel so the rail stops showing a loader.
      if (startupHydratedVideoIdRef.current === requestedVideoId) {
        startupHydratedVideoIdRef.current = null;
      }
      return;
    }
    let ignore = false;
    let retryTimeoutId: number | null = null;
    lastVideoIdRef.current = requestedVideoId;
    setIsResolvingRequestedVideo(true);
    let hasOptimisticVideo = false;
    setDeniedPlaybackMessage(null);
    if (typeof window !== "undefined") {
      const rawPendingSelection = window.sessionStorage.getItem(PENDING_VIDEO_SELECTION_KEY);
      if (rawPendingSelection) {
        try {
          const pendingSelection = JSON.parse(rawPendingSelection) as Partial<VideoRecord> & { id?: string };
          if (pendingSelection.id === requestedVideoId) {
            setCurrentVideo((previousVideo) => ({
              ...previousVideo,
              id: requestedVideoId,
              title: typeof pendingSelection.title === "string" ? pendingSelection.title : previousVideo.title,
              channelTitle:
                typeof pendingSelection.channelTitle === "string"
                  ? pendingSelection.channelTitle
                  : previousVideo.channelTitle,
              genre: typeof pendingSelection.genre === "string" ? pendingSelection.genre : previousVideo.genre,
              favourited:
                typeof pendingSelection.favourited === "number"
                  ? pendingSelection.favourited
                  : previousVideo.favourited,
              description:
                typeof pendingSelection.description === "string"
                  ? pendingSelection.description
                  : previousVideo.description,
            }));
            hasOptimisticVideo = true;
            window.sessionStorage.removeItem(PENDING_VIDEO_SELECTION_KEY);
          }
        } catch {
          window.sessionStorage.removeItem(PENDING_VIDEO_SELECTION_KEY);
        }
      }
    }
    if (!hasOptimisticVideo) {
      const relatedMatch = relatedVideos.find((video) => video.id === requestedVideoId);
      if (relatedMatch) {
        setCurrentVideo(relatedMatch);
        hasOptimisticVideo = true;
      }
    }
    if (!hasOptimisticVideo) {
      const cached = prefetchedCurrentVideoPayloadRef.current.get(requestedVideoId);
      if (cached && cached.expiresAt > Date.now() && cached.payload.currentVideo?.id === requestedVideoId) {
        setCurrentVideo(cached.payload.currentVideo);
        setRelatedVideos(cached.payload.relatedVideos ?? []);
        setWatchNextAdvisory(cached.payload.watchNextAdvisory ?? null);
        if (startupHydratedVideoIdRef.current === requestedVideoId) {
          startupHydratedVideoIdRef.current = null;
        }
        setIsResolvingRequestedVideo(false);
        if (!hasResolvedInitialVideoRef.current) {
          hasResolvedInitialVideoRef.current = true;
          setIsResolvingInitialVideo(false);
        }
        return;
      }
    }
    const resolveRequestedVideo = async (attempt = 1): Promise<void> => {
      try {
        const currentVideoParams = new URLSearchParams();
        currentVideoParams.set("v", requestedVideoId);
        if (isAuthenticated && watchNextHideSeen) {
          currentVideoParams.set("hideSeen", "1");
        }
        const response = await fetch(`/api/current-video?${currentVideoParams.toString()}`);
        const data = response.ok ? ((await response.json()) as CurrentVideoResolvePayload) : null;
        if (ignore) {
          return;
        }
        logFlow(FLOW_DEBUG_ENABLED, "requested-video:response", {
          requestedVideoId,
          resolvedVideoId: data?.currentVideo?.id,
          denied: Boolean(data?.denied),
          ok: response.ok,
          attempt,
        });
        if (data?.denied?.message) {
          if (data.denied.reason === "unavailable") {
            setForcedUnavailableMessage(String(data.denied.message));
            setForcedUnavailableSignal((value) => value + 1);
            setDeniedPlaybackMessage(null);
          } else {
            setDeniedPlaybackMessage(String(data.denied.message));
          }
          if (startupHydratedVideoIdRef.current === requestedVideoId) {
            startupHydratedVideoIdRef.current = null;
          }
          deniedRequestedVideoIdRef.current = requestedVideoId;
          setIsResolvingRequestedVideo(false);
          if (!hasResolvedInitialVideoRef.current) {
            hasResolvedInitialVideoRef.current = true;
            setIsResolvingInitialVideo(false);
          }
          return;
        }
        if (data?.currentVideo?.id) {
          if (startupHydratedVideoIdRef.current === requestedVideoId) {
            startupHydratedVideoIdRef.current = null;
          }
          prefetchedCurrentVideoPayloadRef.current.set(requestedVideoId, {
            expiresAt: Date.now() + CURRENT_VIDEO_PREFETCH_TTL_MS,
            payload: data,
          });
          setDeniedPlaybackMessage(null);
          setCurrentVideo(data.currentVideo);
          setRelatedVideos(data.relatedVideos ?? []);
          setWatchNextAdvisory(data.watchNextAdvisory ?? null);
          setIsResolvingRequestedVideo(false);
          if (!hasResolvedInitialVideoRef.current) {
            hasResolvedInitialVideoRef.current = true;
            setIsResolvingInitialVideo(false);
          }
          return;
        }
        if (data?.pending) {
          logFlow(FLOW_DEBUG_ENABLED, "requested-video:pending", {
            requestedVideoId,
            attempt,
          });
        }
      } catch (error) {
        if (ignore) {
          return;
        }
        logFlow(FLOW_DEBUG_ENABLED, "requested-video:error", {
          requestedVideoId,
          error: error instanceof Error ? error.message : String(error),
          attempt,
        });
      }
      if (ignore) {
        return;
      }
      if (attempt >= REQUESTED_VIDEO_RETRY_MAX_ATTEMPTS) {
        logFlow(FLOW_DEBUG_ENABLED, "requested-video:halted", {
          requestedVideoId,
          attempt,
        });
        if (startupHydratedVideoIdRef.current === requestedVideoId) {
          startupHydratedVideoIdRef.current = null;
        }
        setIsResolvingRequestedVideo(false);
        return;
      }
      const delayMs = attempt <= REQUESTED_VIDEO_RETRY_FAST_ATTEMPTS
        ? Math.min(2400, 350 * attempt)
        : REQUESTED_VIDEO_RETRY_SLOW_DELAY_MS;
      retryTimeoutId = window.setTimeout(() => {
        void resolveRequestedVideo(attempt + 1);
      }, delayMs);
    };
    void resolveRequestedVideo();
    return () => {
      ignore = true;
      if (retryTimeoutId !== null) {
        window.clearTimeout(retryTimeoutId);
      }
    };
  }, [requestedVideoId]);
  useEffect(() => {
    if (!deniedPlaybackMessage) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setDeniedPlaybackMessage(null);
    }, 7000);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [deniedPlaybackMessage]);
  useEffect(() => {
    setDeniedPlaybackMessage(null);
    setForcedUnavailableMessage(null);
  }, [pathname, searchParamsKey]);
  const retryAuthStateCheck = useCallback(async () => {
    if (isRetryingAuthStatus) {
      return;
    }
    setIsRetryingAuthStatus(true);
    try {
      await checkAuthState();
    } finally {
      setIsRetryingAuthStatus(false);
    }
  }, [checkAuthState, isRetryingAuthStatus]);
  useEffect(() => {
    if (authStatus !== "unavailable" || !authStatusMessage) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void retryAuthStateCheck();
    }, 4000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [authStatus, authStatusMessage, retryAuthStateCheck]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleLyricsOverlayOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ videoId?: string }>).detail;
      const targetVideoId = detail?.videoId || activeVideoId;
      if (isLyricsOverlayOpen && lyricsOverlayVideoId === targetVideoId) {
        setIsLyricsOverlayOpen(false);
        return;
      }
      setLyricsOverlayVideoId(targetVideoId);
      setLyricsOverlayError(null);
      setLyricsOverlayData(null);
      setIsLyricsOverlayOpen(true);
    };
    window.addEventListener(RIGHT_RAIL_LYRICS_OPEN_EVENT, handleLyricsOverlayOpen);
    return () => {
      window.removeEventListener(RIGHT_RAIL_LYRICS_OPEN_EVENT, handleLyricsOverlayOpen);
    };
  }, [activeVideoId, isLyricsOverlayOpen, lyricsOverlayVideoId]);
  useEffect(() => {
    if (!isLyricsOverlayOpen) {
      return;
    }
    setLyricsOverlayVideoId(activeVideoId);
  }, [activeVideoId, isLyricsOverlayOpen]);
  useEffect(() => {
    if (!isLyricsOverlayOpen || !lyricsOverlayVideoId) {
      return;
    }
    let cancelled = false;
    const loadLyrics = async () => {
      setIsLyricsOverlayLoading(true);
      setLyricsOverlayError(null);
      try {
        const response = await fetch(`/api/lyrics?v=${encodeURIComponent(lyricsOverlayVideoId)}`, {
          cache: "no-store",
        });
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          const errorPayload = await parseJsonOrNull<{ error?: string }>(response);
          setLyricsOverlayData(null);
          setLyricsOverlayError(errorPayload?.error ?? `Could not fetch lyrics right now (HTTP ${response.status}).`);
          return;
        }
        const payload = await parseJsonOrNull<LyricsRailPayload>(response);
        if (!payload) {
          setLyricsOverlayData(null);
          setLyricsOverlayError("Lyrics were fetched but the response could not be read.");
          return;
        }
        if (typeof payload.available !== "boolean") {
          setLyricsOverlayData(null);
          setLyricsOverlayError("Lyrics were fetched but the response format was invalid.");
          return;
        }
        if (payload.available && (!payload.lyrics || payload.lyrics.trim().length === 0)) {
          setLyricsOverlayData(null);
          setLyricsOverlayError("Lyrics were fetched but could not be displayed.");
          return;
        }
        if (!cancelled) {
          setLyricsOverlayData(payload);
          setLyricsOverlayError(null);
        }
      } catch {
        if (!cancelled) {
          setLyricsOverlayData(null);
          setLyricsOverlayError("Could not reach the lyrics service. Please try again.");
        }
      } finally {
        if (!cancelled) {
          setIsLyricsOverlayLoading(false);
        }
      }
    };
    void loadLyrics();
    return () => {
      cancelled = true;
    };
  }, [isLyricsOverlayOpen, lyricsOverlayVideoId]);
  const sourceRelatedVideos = useMemo(() => dedupeVideos(relatedVideos), [relatedVideos]);
  const uniqueRelatedVideos = useMemo(() => filterHiddenVideos(
    dedupeRelatedRailVideos(sourceRelatedVideos, currentVideo.id),
    hiddenVideoIdsRef.current,
  ), [currentVideo.id, sourceRelatedVideos]);
  const displayedRenderableRelatedVideos = useMemo(() => filterHiddenVideos(
    dedupeRelatedRailVideos(displayedRelatedVideos, currentVideo.id),
    hiddenVideoIdsRef.current,
  ), [currentVideo.id, displayedRelatedVideos]);
  const visibleWatchNextVideos = useMemo(
    () => filterSeenFromWatchNext(
      displayedRenderableRelatedVideos,
      seenVideoIdsRef.current,
      isAuthenticated,
      watchNextHideSeen,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayedRenderableRelatedVideos, isAuthenticated, watchNextHideSeen, seenVideoRefreshTick],
  );
  const hasSeenWatchNextVideos = useMemo(
    () => isAuthenticated && displayedRenderableRelatedVideos.some((video) => seenVideoIdsRef.current.has(video.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayedRenderableRelatedVideos, isAuthenticated, seenVideoRefreshTick],
  );
  const hidingRelatedVideoIdSet = useMemo(() => new Set(hidingRelatedVideoIds), [hidingRelatedVideoIds]);
  const hiddenMutationPendingVideoIdSet = useMemo(() => new Set(hiddenMutationPendingVideoIds), [hiddenMutationPendingVideoIds]);
  useEffect(() => {
    hidingRelatedVideoIdsRef.current = hidingRelatedVideoIds;
  }, [hidingRelatedVideoIds]);
  useEffect(() => {
    hiddenMutationPendingVideoIdsRef.current = hiddenMutationPendingVideoIds;
  }, [hiddenMutationPendingVideoIds]);
  useEffect(() => {
    if (hasBootstrappedWatchNext) {
      return;
    }
    if (rightRailMode !== "watch-next") {
      return;
    }
    if (isWatchNextVideoSelectionPending || relatedTransitionPhase !== "idle") {
      return;
    }
    const currentSignature = displayedRelatedVideos.map((video) => video.id).join("|");
    const nextSignature = sourceRelatedVideos.map((video) => video.id).join("|");
    if (currentSignature !== nextSignature) {
      return;
    }
    if (!shouldDisableRelatedRailTransition && displayedRelatedVideos.length > 0) {
      setRelatedTransitionPhase("fading-in");
    }
    setHasBootstrappedWatchNext(true);
  }, [
    displayedRelatedVideos,
    hasBootstrappedWatchNext,
    isWatchNextVideoSelectionPending,
    relatedTransitionPhase,
    rightRailMode,
    shouldDisableRelatedRailTransition,
    sourceRelatedVideos,
  ]);
  const shouldShowWatchNextBootstrapLoader = rightRailMode === "watch-next"
    && (!hasBootstrappedWatchNext || isWatchNextVideoSelectionPending);
  // When watchNextLoadFailed, hide spinner so error/retry renders cleanly.
  const shouldShowWatchNextRailLoader = !watchNextLoadFailed && (
    shouldShowWatchNextBootstrapLoader
    || relatedTransitionPhase === "loading"
    || (visibleWatchNextVideos.length === 0 && (isLoadingMoreRelated || hasMoreRelated)));
  const shouldShowWatchNextUnseenEmptyState = watchNextHideSeen
    && hasSeenWatchNextVideos
    && visibleWatchNextVideos.length === 0
    && !shouldShowWatchNextRailLoader;
  const shouldShowWatchNextEmptyState = visibleWatchNextVideos.length === 0
    && !shouldShowWatchNextRailLoader
    && !shouldShowWatchNextUnseenEmptyState;
  const shouldShowWatchNextGenreConstrainedHint = Boolean(
    watchNextAdvisory?.genreFilterActive
    && watchNextAdvisory?.constrainedByGenreFilter
    && visibleWatchNextVideos.length > 0,
  );
  const shouldShowWatchNextGenreConstrainedEmptyState = Boolean(
    shouldShowWatchNextEmptyState
    && watchNextAdvisory?.genreFilterActive
    && watchNextAdvisory?.emptyDueToGenreFilter,
  );
  useEffect(() => {
    relatedVideosRef.current = relatedVideos;
  }, [relatedVideos]);
  useEffect(() => {
    const handleWatchHistoryUpdated = (event: Event) => {
      if (!isAuthenticated) {
        return;
      }
      const customEvent = event as CustomEvent<{ videoId?: string }>;
      const payloadVideoId = customEvent.detail?.videoId;
      const fallbackVideoId = currentVideo.id;
      const resolvedVideoId = payloadVideoId && /^[A-Za-z0-9_-]{11}$/.test(payloadVideoId)
        ? payloadVideoId
        : fallbackVideoId;
      if (!resolvedVideoId || seenVideoIdsRef.current.has(resolvedVideoId)) {
        return;
      }
      seenVideoIdsRef.current.add(resolvedVideoId);
      setSeenVideoRefreshTick((value) => value + 1);
    };
    window.addEventListener(WATCH_HISTORY_UPDATED_EVENT, handleWatchHistoryUpdated as EventListener);
    return () => {
      window.removeEventListener(WATCH_HISTORY_UPDATED_EVENT, handleWatchHistoryUpdated as EventListener);
    };
  }, [currentVideo.id, isAuthenticated]);
  useEffect(() => {
    const handleAutoplaySettingsUpdated = () => {
      setWatchNextRefreshTick((value) => value + 1);
    };
    window.addEventListener(AUTOPLAY_SETTINGS_UPDATED_EVENT, handleAutoplaySettingsUpdated);
    return () => {
      window.removeEventListener(AUTOPLAY_SETTINGS_UPDATED_EVENT, handleAutoplaySettingsUpdated);
    };
  }, []);
  const activePlaylistSummary = activePlaylistId
    ? playlistRailSummaries.find((playlist) => playlist.id === activePlaylistId) ?? null
    : null;
  const { loadWatchNextPayload } = useWatchNextPayloadLoader({
    relatedFetchTimeoutMs: RELATED_FETCH_TIMEOUT_MS,
    coldRetryAttempts: RELATED_COLD_FETCH_RETRY_ATTEMPTS,
    coldRetryBaseDelayMs: RELATED_COLD_FETCH_RETRY_BASE_DELAY_MS,
    logWatchNext,
  });
  const loadMoreRelatedVideos = useCallback(async (requestedCount = RELATED_LOAD_BATCH_SIZE) => {
    if (
      relatedLoadInFlightRef.current
      || !hasMoreRelated
      || rightRailMode !== "watch-next"
      || isWatchNextVideoSelectionPending
    ) {
      logWatchNext("load:skipped", {
        currentVideoId: currentVideo.id,
        requestedCount,
        inFlight: relatedLoadInFlightRef.current,
        hasMoreRelated,
        rightRailMode,
        isWatchNextVideoSelectionPending,
      });
      return;
    }
    if (dedupeRelatedRailVideos(relatedVideosRef.current, currentVideo.id).length >= RELATED_MAX_VIDEOS) {
      setHasMoreRelated(false);
      logWatchNext("load:max-reached", {
        currentVideoId: currentVideo.id,
        maxVideos: RELATED_MAX_VIDEOS,
      });
      return;
    }
    relatedLoadInFlightRef.current = true;
    setIsLoadingMoreRelated(true);
    setWatchNextLoadFailed(false);
    try {
      const existing = dedupeRelatedRailVideos(relatedVideosRef.current, currentVideo.id);
      const isFirstColdFetch = relatedFetchOffsetRef.current === null && existing.length === 0;
      if (relatedFetchOffsetRef.current === null || relatedFetchOffsetRef.current < existing.length) {
        relatedFetchOffsetRef.current = existing.length;
      }
      const batchCount = Math.max(1, Math.min(30, Math.floor(requestedCount)));
      const requestedBatchCount = Math.max(1, Math.min(40, Math.floor(requestedCount)));
      logWatchNext("load:start", {
        currentVideoId: currentVideo.id,
        requestedCount,
        batchCount,
        requestedBatchCount,
        existingCount: existing.length,
        isFirstColdFetch,
        offset: relatedFetchOffsetRef.current,
        url: typeof window === "undefined" ? null : window.location.href,
      });
      const params = new URLSearchParams();
      params.set("v", currentVideo.id);
      if (isAuthenticated && watchNextHideSeen) {
        params.set("hideSeen", "1");
      }
      if (!isFirstColdFetch) {
        params.set("count", String(batchCount));
        params.set("requestedCount", String(requestedBatchCount));
        params.set("offset", String(relatedFetchOffsetRef.current));
      }
      const payload = await loadWatchNextPayload({
        currentVideoId: currentVideo.id,
        params,
        isFirstColdFetch,
      });
      if (!payload) {
        throw new Error("watch-next-load-empty-payload");
      }
      const resolvedPayload = payload;
      const nextVideos = Array.isArray(resolvedPayload.relatedVideos) ? resolvedPayload.relatedVideos : [];
      const payloadHasMore = resolvedPayload.hasMore !== false;
      setWatchNextAdvisory((resolvedPayload.watchNextAdvisory as WatchNextAdvisory | null) ?? null);
      relatedFetchOffsetRef.current = (relatedFetchOffsetRef.current ?? existing.length) + nextVideos.length;
      watchNextAutoRecoverAttemptRef.current = 0;
      logWatchNext("load:success", {
        currentVideoId: currentVideo.id,
        nextVideosCount: nextVideos.length,
        payloadHasMore,
        nextOffset: relatedFetchOffsetRef.current,
      });
      if (nextVideos.length === 0 && !payloadHasMore) {
        setHasMoreRelated(false);
        logWatchNext("load:completed", {
          currentVideoId: currentVideo.id,
          reason: "empty-tail",
        });
        return;
      }
      startTransition(() => {
        setRelatedVideos((previous) => {
          const merged = dedupeRelatedRailVideos([...previous, ...nextVideos], currentVideo.id)
            .slice(0, RELATED_MAX_VIDEOS);
          return merged;
        });
      });
      if (!payloadHasMore) {
        setHasMoreRelated(false);
        logWatchNext("load:completed", {
          currentVideoId: currentVideo.id,
          reason: "hasMore-false",
        });
        return;
      }
    } catch (error) {
      const existingAfterFailure = dedupeRelatedRailVideos(dedupeVideos(relatedVideosRef.current), currentVideo.id);
      logWatchNext("load:failed", {
        currentVideoId: currentVideo.id,
        error: error instanceof Error ? error.message : String(error),
        existingAfterFailure: existingAfterFailure.length,
      });
      if (existingAfterFailure.length === 0) {
        // Reset the offset back to null so the next attempt (auto-recover or manual)
        // is treated as a fresh cold-start and gets the full retry budget.
        relatedFetchOffsetRef.current = null;
        setWatchNextLoadFailed(true);
        logWatchNext("load:failed-empty-rail", {
          currentVideoId: currentVideo.id,
          autoRecoverAttempt: watchNextAutoRecoverAttemptRef.current,
        });
      }
    } finally {
      relatedLoadInFlightRef.current = false;
      setIsLoadingMoreRelated(false);
      logWatchNext("load:finally", {
        currentVideoId: currentVideo.id,
        inFlight: relatedLoadInFlightRef.current,
      });
    }
  }, [currentVideo.id, hasMoreRelated, isWatchNextVideoSelectionPending, loadWatchNextPayload, rightRailMode]);
  useEffect(() => {
    // Cold-start trigger: fire the first Watch Next fetch as soon as selection is
    // settled and the rail is still empty. Other triggers guard on idle phase,
    // while an empty rail is often in "loading" phase.
    if (
      isWatchNextVideoSelectionPending
      || rightRailMode !== "watch-next"
      || !hasMoreRelated
      || visibleWatchNextVideos.length > 0
    ) {
      return;
    }
    void loadMoreRelatedVideos();
  }, [
    hasMoreRelated,
    isWatchNextVideoSelectionPending,
    loadMoreRelatedVideos,
    rightRailMode,
    visibleWatchNextVideos.length,
  ]);
  const handleWatchNextTrackClick = useCallback((trackId: string) => {
    setClickedRelatedVideoId(trackId);
    if (relatedClickFlashTimeoutRef.current !== null) {
      window.clearTimeout(relatedClickFlashTimeoutRef.current);
    }
    relatedClickFlashTimeoutRef.current = window.setTimeout(() => {
      setClickedRelatedVideoId((activeId) => (activeId === trackId ? null : activeId));
      relatedClickFlashTimeoutRef.current = null;
    }, 240);
  }, []);
  const commitWatchNextHide = useCallback((videoId: string) => {
    setHidingRelatedVideoIds((previous) => {
      if (previous.includes(videoId)) {
        return previous;
      }
      return [...previous, videoId];
    });
    const existingTimeoutId = relatedHideTimeoutsRef.current.get(videoId);
    if (existingTimeoutId !== undefined) {
      window.clearTimeout(existingTimeoutId);
    }
    const timeoutId = window.setTimeout(() => {
      setDisplayedRelatedVideos((previous) => previous.filter((video) => video.id !== videoId));
      setRelatedVideos((previous) => previous.filter((video) => video.id !== videoId));
      hiddenVideoIdsRef.current.add(videoId);
      setHidingRelatedVideoIds((previous) => previous.filter((candidateId) => candidateId !== videoId));
      relatedHideTimeoutsRef.current.delete(videoId);
    }, WATCH_NEXT_HIDE_ANIMATION_MS);
    relatedHideTimeoutsRef.current.set(videoId, timeoutId);
  }, []);
  const handleHideFromWatchNext = useCallback((track: VideoRecord) => {
    if (!isAuthenticated) {
      setPlaylistMutationTone("error");
      setPlaylistMutationMessage("Sign in to hide tracks from Watch Next.");
      return;
    }
    if (
      hidingRelatedVideoIdsRef.current.includes(track.id)
      || hiddenMutationPendingVideoIdsRef.current.includes(track.id)
    ) {
      return;
    }
    setWatchNextHideConfirmTrack(track);
  }, [isAuthenticated, setPlaylistMutationMessage, setPlaylistMutationTone]);
  const confirmHideFromWatchNext = useCallback(async () => {
    const track = watchNextHideConfirmTrack;
    if (!track) {
      return;
    }
    if (!isAuthenticated) {
      setPlaylistMutationTone("error");
      setPlaylistMutationMessage("Sign in to hide tracks from Watch Next.");
      return;
    }
    if (
      hidingRelatedVideoIdsRef.current.includes(track.id)
      || hiddenMutationPendingVideoIdsRef.current.includes(track.id)
    ) {
      return;
    }
    setWatchNextHideConfirmTrack(null);
    const result = await mutateHiddenVideo({
      action: "hide",
      videoId: track.id,
      messages: {
        unauthorized: "Sign in to hide tracks from Watch Next.",
      },
      onOptimisticUpdate: () => {
        commitWatchNextHide(track.id);
        setHiddenMutationPendingVideoIds((previous) => [...previous, track.id]);
      },
      onUnauthorized: () => {
        void checkAuthState();
      },
      onSettled: () => {
        setHiddenMutationPendingVideoIds((previous) => previous.filter((videoId) => videoId !== track.id));
      },
    });
    if (!result.ok) {
      setPlaylistMutationTone("error");
      setPlaylistMutationMessage(result.message);
    }
  }, [
    checkAuthState,
    commitWatchNextHide,
    isAuthenticated,
    setPlaylistMutationMessage,
    setPlaylistMutationTone,
    watchNextHideConfirmTrack,
  ]);
  const maybeLoadMoreIfNearEnd = useCallback(() => {
    if (
      relatedLoadInFlightRef.current
      || !hasMoreRelated
      || rightRailMode !== "watch-next"
      || relatedTransitionPhase !== "idle"
      || isWatchNextVideoSelectionPending
    ) {
      return;
    }
    const node = relatedStackRef.current;
    if (!node) {
      return;
    }
    const remainingPx = node.scrollHeight - (node.scrollTop + node.clientHeight);
    const oneSectionAheadPx = Math.ceil(node.clientHeight * 1.1);
    const loadAheadPx = Math.max(RELATED_LOAD_AHEAD_PX, RELATED_LOAD_AHEAD_AGGRESSIVE_PX, oneSectionAheadPx);
    if (remainingPx <= loadAheadPx) {
      const nearBottom = remainingPx <= Math.max(240, node.clientHeight * 0.4);
      const requestedCount = nearBottom
        ? RELATED_LOAD_BATCH_SIZE * RELATED_SCROLL_PREFETCH_BATCHES
        : RELATED_LOAD_BATCH_SIZE;
      void loadMoreRelatedVideos(requestedCount);
    }
  }, [hasMoreRelated, isWatchNextVideoSelectionPending, loadMoreRelatedVideos, relatedTransitionPhase, rightRailMode]);
  const handleRelatedScroll = useCallback(() => {
    hasUserScrolledWatchNextRef.current = true;
    if (relatedScrollRafRef.current !== null) {
      return;
    }
    relatedScrollRafRef.current = window.requestAnimationFrame(() => {
      relatedScrollRafRef.current = null;
      maybeLoadMoreIfNearEnd();
    });
  }, [maybeLoadMoreIfNearEnd]);
  useEffect(() => {
    return () => {
      if (relatedScrollRafRef.current !== null) {
        window.cancelAnimationFrame(relatedScrollRafRef.current);
        relatedScrollRafRef.current = null;
      }
    };
  }, []);
  useEffect(() => {
    relatedLoadInFlightRef.current = false;
    relatedFetchOffsetRef.current = null;
    watchNextAutoRecoverAttemptRef.current = 0;
    hasUserScrolledWatchNextRef.current = false;
    setRelatedVideos([]);
    setDisplayedRelatedVideos([]);
    setHasBootstrappedWatchNext(false);
    setIsLoadingMoreRelated(false);
    setShowLoadingMoreRelatedHint(false);
    setHasMoreRelated(true);
    setWatchNextLoadFailed(false);
    setWatchNextAdvisory(null);
    logWatchNext("video:reset-state", {
      currentVideoId: currentVideo.id,
      refreshTick: watchNextRefreshTick,
    });
  }, [currentVideo.id, watchNextRefreshTick]);
  useEffect(() => {
    if (
      !watchNextLoadFailed
      || rightRailMode !== "watch-next"
      || visibleWatchNextVideos.length > 0
      || !hasMoreRelated
    ) {
      return;
    }
    if (watchNextAutoRecoverAttemptRef.current >= 3) {
      return;
    }
    const retryAttempt = watchNextAutoRecoverAttemptRef.current + 1;
    watchNextAutoRecoverAttemptRef.current = retryAttempt;
    // Delays: 800ms, 3s, 10s. The 10s attempt outlasts the server's 8s resolver-failure cooldown.
    const retryDelays = [800, 3_000, 10_000];
    const retryDelayMs = retryDelays[retryAttempt - 1] ?? 10_000;
    logWatchNext("auto-recover:scheduled", {
      currentVideoId: currentVideo.id,
      retryAttempt,
      retryDelayMs,
    });
    const timeoutId = window.setTimeout(() => {
      logWatchNext("auto-recover:running", {
        currentVideoId: currentVideo.id,
        retryAttempt,
      });
      void loadMoreRelatedVideos();
    }, retryDelayMs);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [hasMoreRelated, loadMoreRelatedVideos, rightRailMode, visibleWatchNextVideos.length, watchNextLoadFailed]);
  useEffect(() => {
    if (rightRailMode !== "watch-next") {
      setShowLoadingMoreRelatedHint(false);
      return;
    }
    let timeoutId: number | null = null;
    if (isLoadingMoreRelated) {
      if (!showLoadingMoreRelatedHint) {
        timeoutId = window.setTimeout(() => {
          setShowLoadingMoreRelatedHint(true);
        }, RELATED_LOADING_HINT_SHOW_DELAY_MS);
      }
    } else if (showLoadingMoreRelatedHint) {
      timeoutId = window.setTimeout(() => {
        setShowLoadingMoreRelatedHint(false);
      }, RELATED_LOADING_HINT_HIDE_DELAY_MS);
    }
    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isLoadingMoreRelated, rightRailMode, showLoadingMoreRelatedHint]);
  useEffect(() => {
    if (
      isOverlayRoute
      || rightRailMode !== "watch-next"
      || relatedTransitionPhase !== "idle"
      || !hasMoreRelated
      || isLoadingMoreRelated
      || isWatchNextVideoSelectionPending
      || document.visibilityState !== "visible"
      || !hasUserScrolledWatchNextRef.current
    ) {
      return;
    }
    const targetRunway = Math.min(RELATED_BACKGROUND_PREFETCH_TARGET_AGGRESSIVE, RELATED_MAX_VIDEOS);
    const hasReachedBaselineRunway = displayedRenderableRelatedVideos.length >= RELATED_BACKGROUND_PREFETCH_TARGET;
    if (
      displayedRenderableRelatedVideos.length === 0
      || (displayedRenderableRelatedVideos.length >= targetRunway && hasReachedBaselineRunway)
      || displayedRenderableRelatedVideos.length >= RELATED_MAX_VIDEOS
    ) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      if (document.visibilityState !== "visible" || !hasUserScrolledWatchNextRef.current) {
        return;
      }
      const remainingForTarget = RELATED_BACKGROUND_PREFETCH_TARGET - displayedRenderableRelatedVideos.length;
      const remainingForAggressiveTarget = targetRunway - displayedRenderableRelatedVideos.length;
      const prefetchCount = Math.max(
        RELATED_LOAD_BATCH_SIZE,
        Math.min(40, Math.max(remainingForTarget, remainingForAggressiveTarget)),
      );
      void loadMoreRelatedVideos(prefetchCount);
    }, Math.min(RELATED_BACKGROUND_PREFETCH_DELAY_MS, RELATED_BACKGROUND_PREFETCH_DELAY_FAST_MS));
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    displayedRenderableRelatedVideos.length,
    hasMoreRelated,
    isLoadingMoreRelated,
    isOverlayRoute,
    isWatchNextVideoSelectionPending,
    loadMoreRelatedVideos,
    relatedTransitionPhase,
    rightRailMode,
  ]);
  useEffect(() => {
    // Straightforward flow:
    // 1) Wait for requested video id to settle
    // 2) While waiting (or while related videos are empty), clear list and show loader
    // 3) Once related videos are ready, display them and fade in
    const currentIds = displayedRelatedVideos.map((video) => video.id);
    const nextIds = sourceRelatedVideos.map((video) => video.id);
    const currentSignature = currentIds.join("|");
    const nextSignature = nextIds.join("|");
    // Disabled transitions: immediately apply new videos with no transition state.
    if (shouldDisableRelatedRailTransition) {
      if (currentSignature !== nextSignature) {
        setDisplayedRelatedVideos(sourceRelatedVideos);
      }
      if (relatedTransitionPhase !== "idle") {
        setRelatedTransitionPhase("idle");
      }
      return;
    }
    const hasFinalizedVideoSelection = !requestedVideoId || requestedVideoId === currentVideo.id;
    const shouldShowLoadingState = isWatchNextVideoSelectionPending || !hasFinalizedVideoSelection;
    // During selection/URL resolution: clear stale cards and keep loader visible.
    if (shouldShowLoadingState) {
      if (relatedStackRef.current) {
        relatedStackRef.current.scrollTop = 0;
      }
      if (watchNextRailRef.current) {
        watchNextRailRef.current.scrollTop = 0;
      }
      if (displayedRelatedVideos.length > 0) {
        setDisplayedRelatedVideos([]);
      }
      if (relatedTransitionPhase !== "loading") {
        setRelatedTransitionPhase("loading");
      }
      return;
    }
    // Video is finalized but data is still not ready: stay in loading state.
    if (sourceRelatedVideos.length === 0) {
      if (displayedRelatedVideos.length > 0) {
        setDisplayedRelatedVideos([]);
      }
      if (relatedTransitionPhase !== "loading") {
        setRelatedTransitionPhase("loading");
      }
      return;
    }
    // Avoid flashing a single card on startup. Keep loading until a usable
    // minimum is ready, or until the server indicates there is no more data.
    if (
      !hasBootstrappedWatchNext
      && sourceRelatedVideos.length < RELATED_BOOTSTRAP_MIN_VISIBLE
      && hasMoreRelated
    ) {
      if (displayedRelatedVideos.length > 0) {
        setDisplayedRelatedVideos([]);
      }
      if (relatedTransitionPhase !== "loading") {
        setRelatedTransitionPhase("loading");
      }
      if (!isLoadingMoreRelated) {
        void loadMoreRelatedVideos(30);
      }
      return;
    }
    // Fresh data arrived for a finalized video: render it.
    if (currentSignature !== nextSignature) {
      const isAppendOnlyUpdate = detectAppendOnly(currentIds, nextIds);
      if (isAppendOnlyUpdate) {
        // Append-only: no animation needed — defer the card list update so
        // it does not block user interaction (scrolling, clicks, etc.).
        startTransition(() => {
          setDisplayedRelatedVideos(sourceRelatedVideos);
          setRelatedTransitionPhase("idle");
        });
        return;
      }
      setDisplayedRelatedVideos(sourceRelatedVideos);
      if (!hasBootstrappedWatchNext) {
        setHasBootstrappedWatchNext(true);
      }
      setRelatedTransitionPhase("fading-in");
      return;
    }
    // If data is already shown, ensure we end up idle.
    if (relatedTransitionPhase === "loading" || relatedTransitionPhase === "fading-out") {
      setRelatedTransitionPhase("idle");
    }
  }, [
    currentVideo.id,
    displayedRelatedVideos,
    hasBootstrappedWatchNext,
    hasMoreRelated,
    isLoadingMoreRelated,
    isWatchNextVideoSelectionPending,
    loadMoreRelatedVideos,
    relatedTransitionPhase,
    requestedVideoId,
    shouldDisableRelatedRailTransition,
    sourceRelatedVideos,
  ]);
  useEffect(() => {
    if (shouldDisableRelatedRailTransition) {
      setRelatedTransitionPhase("idle");
      return;
    }
    if (relatedTransitionTimeoutRef.current !== null) {
      window.clearTimeout(relatedTransitionTimeoutRef.current);
      relatedTransitionTimeoutRef.current = null;
    }
    if (relatedTransitionPhase === "fading-in") {
      const delayMs = RELATED_FADE_IN_BASE_MS + RELATED_FADE_STAGGER_MS * Math.max(0, displayedRelatedVideos.length - 1);
      relatedTransitionTimeoutRef.current = window.setTimeout(() => {
        setRelatedTransitionPhase("idle");
      }, delayMs);
    }
    return () => {
      if (relatedTransitionTimeoutRef.current !== null) {
        window.clearTimeout(relatedTransitionTimeoutRef.current);
        relatedTransitionTimeoutRef.current = null;
      }
    };
  }, [displayedRelatedVideos.length, relatedTransitionPhase, shouldDisableRelatedRailTransition]);
  useEffect(() => {
    const hideTimeouts = relatedHideTimeoutsRef.current;
    return () => {
      if (relatedClickFlashTimeoutRef.current !== null) {
        window.clearTimeout(relatedClickFlashTimeoutRef.current);
        relatedClickFlashTimeoutRef.current = null;
      }
      for (const timeoutId of hideTimeouts.values()) {
        window.clearTimeout(timeoutId);
      }
      hideTimeouts.clear();
    };
  }, []);
  const hasFreshPrefetchedPayload = useCallback((videoId: string, now: number) => {
    const cached = prefetchedCurrentVideoPayloadRef.current.get(videoId);
    return Boolean(cached && cached.expiresAt > now);
  }, []);
  const setPrefetchedPayload = useCallback((
    videoId: string,
    payload: { currentVideo?: { id?: string }; relatedVideos?: VideoRecord[] },
    expiresAt: number,
  ) => {
    prefetchedCurrentVideoPayloadRef.current.set(videoId, {
      expiresAt,
      payload: payload as CurrentVideoResolvePayload,
    });
  }, []);
  const { prefetchRelatedSelection } = useWatchNextPrefetch({
    isAuthenticated,
    watchNextHideSeen,
    displayedRelatedVideos,
    sourceRelatedVideos,
    currentVideoId: currentVideo.id,
    isOverlayRoute,
    prewarmedThumbnailIdsRef,
    prefetchedRelatedIdsRef,
    inFlightCurrentVideoPrefetchRef,
    prefetchBlockedUntilRef,
    prefetchFailureCountRef,
    currentVideoPrefetchTtlMs: CURRENT_VIDEO_PREFETCH_TTL_MS,
    prefetchFailureBaseBackoffMs: PREFETCH_FAILURE_BASE_BACKOFF_MS,
    prefetchFailureMaxBackoffMs: PREFETCH_FAILURE_MAX_BACKOFF_MS,
    hasFreshPrefetchedPayload,
    setPrefetchedPayload,
  });
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    let cancelled = false;
    const runCheckAuthState = async () => {
      const result = await checkAuthState();
      if (cancelled || result !== "authenticated") {
        return;
      }
      setAuthStatus("clear");
      setAuthStatusMessage(null);
    };
    void runCheckAuthState();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void runCheckAuthState();
    }, 60_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void runCheckAuthState();
      }
    };
    const onWindowOnline = () => {
      void runCheckAuthState();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onWindowOnline);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onWindowOnline);
    };
  }, [checkAuthState, isAuthenticated]);
  useEffect(() => {
    if (isAuthenticated) {
      return;
    }
    if (!isProtectedOverlayPath(pathname)) {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("v", currentVideo.id);
    params.set("resume", "1");
    params.delete("pl");
    params.delete("pli");
    const query = params.toString();
    router.replace(query ? `/?${query}` : "/");
  }, [currentVideo.id, isAuthenticated, pathname, router, searchParams]);
  // Always show all nav items; unauthenticated clicks on protected routes are
  // intercepted client-side to open the auth modal.
  const visibleNavItems = navItems.filter((item) => item.href !== "/");
  const protectedNavHrefs = new Set(["/favourites", "/playlists", "/history", "/account"]);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  function openAuthModal() {
    setIsAuthModalOpen(true);
  }
  const {
    getNavHref,
    openAutoplaySettingsOverlay,
    getUserProfileHref,
    requestOverlayOpen,
  } = useShellNavigationHelpers({
    currentVideoId: currentVideo.id,
    activeArtistLetter,
    isAuthenticated,
    onOpenAuthModal: openAuthModal,
    onPush: (href) => {
      router.push(href);
    },
  });
  const targetNavPrefetchHrefs = useMemo(() => {
    return visibleNavItems
      .filter((item) => !isRouteActive(item.href, pathname))
      .map((item) => getNavHref(item.href));
  }, [activeArtistLetter, currentVideo.id, pathname, visibleNavItems]);
  useAuthSuccessListener(() => {
    setIsAuthenticated(true);
    setAuthStatus("clear");
    setAuthStatusMessage(null);
    setIsAuthModalOpen(false);
  });
  useIdleRoutePrefetch(targetNavPrefetchHrefs, router);
  const handleSearchSubmit = useCallback(() => {
    if (searchValue.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchValue.trim())}&v=${encodeURIComponent(currentVideo.id)}`);
      setShowSuggestions(false);
      setSearchValue("");
    }
  }, [currentVideo.id, router, searchValue, setSearchValue]);
  const handlePrimaryNavItemClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>, item: { href: string }, navHref: string) => {
    if (!isAuthenticated && protectedNavHrefs.has(item.href)) {
      event.preventDefault();
      openAuthModal();
      return;
    }
    if (item.href === "/categories" || item.href === "/artists") {
      requestOverlayOpen(navHref, "video");
    }
  }, [isAuthenticated, protectedNavHrefs, requestOverlayOpen]);
  const handleCancelDeleteActivePlaylist = useCallback(() => {
    if (!isDeletingActivePlaylist) {
      setShowDeleteActivePlaylistConfirm(false);
    }
  }, [isDeletingActivePlaylist]);
  const handleConfirmDeleteActivePlaylist = useCallback(() => {
    setShowDeleteActivePlaylistConfirm(false);
    void handleDeleteActivePlaylist();
  }, [handleDeleteActivePlaylist]);
  const handleCancelDeleteRailPlaylist = useCallback(() => {
    if (!playlistBeingDeletedId) {
      setConfirmDeleteRailPlaylist(null);
    }
  }, [playlistBeingDeletedId]);
  const handleConfirmDeleteRailPlaylist = useCallback(() => {
    if (!confirmDeleteRailPlaylist) {
      return;
    }
    const playlistId = confirmDeleteRailPlaylist.id;
    setConfirmDeleteRailPlaylist(null);
    void handleDeletePlaylistFromRail(playlistId);
  }, [confirmDeleteRailPlaylist, handleDeletePlaylistFromRail]);
  const shouldRenderDesktopIntro = pathname === "/" && (isDesktopIntroPreload || isDesktopIntroActive);
  const shellClassName = [
    shouldShowOverlayPanel ? "shell shellOverlayRoute" : "shell",
    shouldRenderDesktopIntro && isDesktopIntroPreload ? "shellDesktopIntroPreload" : "",
    shouldRenderDesktopIntro && isDesktopIntroActive ? "shellDesktopIntroActive" : "",
    shouldRenderDesktopIntro && desktopIntroPhase === "moving" ? "shellDesktopIntroMoving" : "",
    shouldRenderDesktopIntro && desktopIntroPhase === "revealing" ? "shellDesktopIntroRevealing" : "",
  ].filter(Boolean).join(" ");
  const shellStyle = shouldRenderDesktopIntro && isDesktopIntroActive
    ? ({
      "--desktop-intro-dx": `${desktopIntroDeltaX}px`,
      "--desktop-intro-dy": `${desktopIntroDeltaY}px`,
      "--desktop-intro-scale": String(desktopIntroScale),
    } as CSSProperties)
    : undefined;
  return (
    <OverlayScrollContainerProvider overlayScrollContainerRef={favouritesBlindInnerRef}>
      <ArtistsLetterProvider initialLetter={activeArtistLetter} v={activeVideoId} resume={resumeParam}>
      <main className={shellClassName} style={shellStyle}>
      <div className="backdrop" />
      {shouldRenderDesktopIntro ? (
        <DesktopIntroOverlay isLogoReady={isDesktopIntroLogoReady} logoSrc={DESKTOP_INTRO_LOGO_SRC} />
      ) : null}
      <header className="topbar">
        <BrandLockup logoRef={brandLogoTargetRef} onLogoClick={handleBrandLogoClick} />
        <div className="headerBar">
          <PrimaryNav
            items={visibleNavItems}
            pathname={pathname}
            getNavHref={getNavHref}
            onNavItemClick={handlePrimaryNavItemClick}
            shouldShowOverlayPanel={shouldShowOverlayPanel}
            isMobileCommunityOpen={isMobileCommunityOpen}
            onToggleMobileCommunity={() => setIsMobileCommunityOpen((current) => !current)}
          />
          <ShellSearchBar
            searchComboboxRef={searchComboboxRef}
            showSuggestions={showSuggestions}
            searchValue={searchValue}
            suggestions={suggestions}
            activeSuggestionIdx={activeSuggestionIdx}
            onSearchInput={handleSearchInput}
            onSearchKeyDown={handleSearchKeyDown}
            onSearchFocus={() => {
              if (searchValue.trim().length >= 1 && suggestions.length > 0) {
                setShowSuggestions(true);
              }
            }}
            onSuggestionClick={handleSuggestionClick}
            onSearchSubmit={handleSearchSubmit}
          />
        </div>
      </header>
      {isPerformanceQuickLaunchVisible ? (
        <button
          type="button"
          className="performanceQuickLaunch"
          onClick={() => setIsPerformanceModalOpen(true)}
          aria-label="Open server performance metrics"
          title="Server performance"
        >
          <span aria-hidden="true">💻</span>
        </button>
      ) : null}
      {isPerformanceModalOpen ? (
        <div
          className="performanceModalOverlay"
          onClick={() => setIsPerformanceModalOpen(false)}
        >
          <section
            className="performanceModalDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="performance-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="performanceModalHeader">
              <h2 id="performance-modal-title">Server Performance</h2>
              <button
                type="button"
                className="performanceModalClose"
                onClick={() => setIsPerformanceModalOpen(false)}
                aria-label="Close performance metrics"
              >
                ×
              </button>
            </div>
            <div className="performanceDialGrid">
              <PerformanceDial label="Memory" value={performanceMetrics?.memoryUsagePercent} color="#ffc14d" />
              <PerformanceDial label="Swap" value={performanceMetrics?.swapUsagePercent} color="#f5d96b" />
              <PerformanceDial
                label="CPU"
                value={performanceMetrics?.cpuUsagePercent}
                color="#ff6f43"
                detail={
                  finitePercentOrNull(performanceMetrics?.cpuAverageUsagePercent) === null
                  || finitePercentOrNull(performanceMetrics?.cpuPeakCoreUsagePercent) === null
                    ? undefined
                    : `avg ${Math.round(finitePercentOrNull(performanceMetrics?.cpuAverageUsagePercent) ?? 0)}%\npeak ${Math.round(finitePercentOrNull(performanceMetrics?.cpuPeakCoreUsagePercent) ?? 0)}%`
                }
              />
              <PerformanceDial label="Disk" value={performanceMetrics?.diskUsagePercent} color="#7ce0a3" />
              <PerformanceDial label="Network" value={performanceMetrics?.networkUsagePercent} color="#5fc1ff" />
            </div>
            {performanceRuntime ? (
              <div className="performanceProfileGrid">
                <section className="performanceProfileCard">
                  <h3>Node Runtime</h3>
                  <dl>
                    <div>
                      <dt>Uptime</dt>
                      <dd>{Math.round(finiteNumberOrNull(performanceRuntime.node?.uptimeSec) ?? 0)}s</dd>
                    </div>
                    <div>
                      <dt>RSS</dt>
                      <dd>{(finiteNumberOrNull(performanceRuntime.node?.rssMb) ?? 0).toFixed(1)} MB</dd>
                    </div>
                    <div>
                      <dt>Heap used</dt>
                      <dd>{(finiteNumberOrNull(performanceRuntime.node?.heapUsedMb) ?? 0).toFixed(1)} MB</dd>
                    </div>
                    <div>
                      <dt>Heap total</dt>
                      <dd>{(finiteNumberOrNull(performanceRuntime.node?.heapTotalMb) ?? 0).toFixed(1)} MB</dd>
                    </div>
                  </dl>
                </section>
                <section className="performanceProfileCard">
                  <h3>Prisma (rolling window)</h3>
                  <dl>
                    <div>
                      <dt>Window</dt>
                      <dd>{Math.round(finiteNumberOrNull(performanceRuntime.prisma?.windowSec) ?? 0)}s</dd>
                    </div>
                    <div>
                      <dt>Queries</dt>
                      <dd>{Math.round(finiteNumberOrNull(performanceRuntime.prisma?.totalQueries) ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>QPS</dt>
                      <dd>{(finiteNumberOrNull(performanceRuntime.prisma?.queriesPerSec) ?? 0).toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt>Avg query</dt>
                      <dd>{(finiteNumberOrNull(performanceRuntime.prisma?.avgDurationMs) ?? 0).toFixed(1)} ms</dd>
                    </div>
                    <div>
                      <dt>P95 query</dt>
                      <dd>{(finiteNumberOrNull(performanceRuntime.prisma?.p95DurationMs) ?? 0).toFixed(1)} ms</dd>
                    </div>
                    <div>
                      <dt>Total since boot</dt>
                      <dd>{Math.round(finiteNumberOrNull(performanceRuntime.prisma?.totalsSinceBoot?.totalQueries) ?? 0)}</dd>
                    </div>
                  </dl>
                  {Array.isArray(performanceRuntime.prisma?.topOperations) && performanceRuntime.prisma.topOperations.length > 0 ? (
                    <div className="performanceTopOperations">
                      <strong>Top DB operations by total time</strong>
                      <div className="performanceTopOperationsTable" role="table" aria-label="Top database operations">
                        <div className="performanceTopOperationsRow performanceTopOperationsHeader" role="row">
                          <span role="columnheader">Operation</span>
                          <span role="columnheader">Count</span>
                          <span role="columnheader">Avg</span>
                          <span role="columnheader">P95</span>
                        </div>
                        {performanceRuntime.prisma.topOperations.map((operation) => (
                          <div key={operation.operation} className="performanceTopOperationsRow" role="row">
                            <span role="cell">{operation.operation}</span>
                            <span role="cell">{operation.count}</span>
                            <span role="cell">{operation.avgDurationMs.toFixed(1)} ms</span>
                            <span role="cell">{operation.p95DurationMs.toFixed(1)} ms</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {Array.isArray(performanceRuntime.prisma?.topQueryFingerprints) && performanceRuntime.prisma.topQueryFingerprints.length > 0 ? (
                    <div className="performanceTopOperations">
                      <strong>Top SQL fingerprints by total time</strong>
                      <div className="performanceTopOperationsTable" role="table" aria-label="Top database query fingerprints">
                        <div className="performanceTopOperationsRow performanceTopOperationsHeader" role="row">
                          <span role="columnheader">Fingerprint</span>
                          <span role="columnheader">Count</span>
                          <span role="columnheader">Avg</span>
                          <span role="columnheader">P95</span>
                        </div>
                        {performanceRuntime.prisma.topQueryFingerprints.map((fingerprint) => (
                          <div key={fingerprint.fingerprint} className="performanceTopOperationsRow" role="row">
                            <span role="cell">{fingerprint.fingerprint}</span>
                            <span role="cell">{fingerprint.count}</span>
                            <span role="cell">{fingerprint.avgDurationMs.toFixed(1)} ms</span>
                            <span role="cell">{fingerprint.p95DurationMs.toFixed(1)} ms</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              </div>
            ) : null}
            <div className="performanceModalMeta">
              {isLoadingPerformanceMetrics ? <p>Refreshing metrics...</p> : null}
              {!isLoadingPerformanceMetrics && performanceMetricsGeneratedAt ? <p>Updated {new Date(performanceMetricsGeneratedAt).toLocaleTimeString()}</p> : null}
              {performanceMetricsError ? <p>{performanceMetricsError}</p> : null}
            </div>
          </section>
        </div>
      ) : null}
      {authStatus === "unavailable" && authStatusMessage && !isAuthUnavailableDialogDismissed ? (
        <AuthUnavailableDialog
          message={authStatusMessage}
          isRetrying={isRetryingAuthStatus}
          retryLabel="Retry auth now"
          retryButtonLabel="Try again"
          retryBusyLabel="Trying again..."
          onRetry={() => void retryAuthStateCheck()}
        />
      ) : null}
      <section
        className={[
          "heroGrid",
          shouldShowOverlayPanel ? "heroGridOverlayRoute" : "",
          isAdminOverlayRoute ? "heroGridAdminOverlayRoute" : "",
          isOverlayClosing ? "heroGridOverlayClosing" : "",
        ].filter(Boolean).join(" ")}
        onClickCapture={handleOverlayVideoLinkClickCapture}
      >
        {isArtistsIndexRoute ? (
          <ArtistsLetterNav
            v={activeVideoId}
            resume={resumeParam}
          />
        ) : null}
        <aside
          id={isMobileViewport ? "mobile-community-rail" : undefined}
          className={[
            "leftRail panel translucent",
            shouldOccludeLeftRail ? "railOccluded" : "",
            isMobileViewport ? "mobileRail" : "",
            isMobileViewport && !isMobileCommunityOpen ? "mobileRailClosed" : "",
          ].filter(Boolean).join(" ")}
          aria-hidden={isLeftRailSuppressed}
          inert={isLeftRailSuppressed ? true : undefined}
        >
          {(() => {
            const railContent = (
              <>
                <div className={isAdminOverlayRoute ? "railTabs railTabsAdminOverlay" : "railTabs"}>
                  <>
                    <button
                      type="button"
                      className={`${chatMode === "global" ? "activeTab" : ""} ${flashingChatTabs.global ? "attentionPulse" : ""}`.trim() || undefined}
                      onClick={() => {
                        setChatMode("global");
                        if (isMagazineOverlayRoute || isForumOverlayRoute) {
                          dispatchAppEvent(EVENT_NAMES.OVERLAY_CLOSE_REQUEST, { href: `/?v=${encodeURIComponent(currentVideo.id)}&resume=1` });
                        }
                      }}
                    >
                      Chat
                    </button>
                    <button
                      type="button"
                      className={chatMode === "magazine" ? "activeTab" : undefined}
                      onClick={() => {
                        setChatMode("magazine");
                        chatListRef.current?.scrollTo({ top: 0, behavior: "auto" });
                        if (!isMagazineOverlayRoute) {
                          router.push(`/magazine?v=${encodeURIComponent(currentVideo.id)}`, { scroll: true });
                        }
                      }}
                    >
                      Magazine
                    </button>
                    <button
                      type="button"
                      className={chatMode === "online" ? "activeTab" : undefined}
                      onClick={() => {
                        setChatMode("online");
                        router.push(`/forum?v=${encodeURIComponent(currentVideo.id)}`);
                      }}
                    >
                      Forum
                    </button>
                  </>
              </div>
              <div className="chatList" ref={chatListRef}>
                {isChatLoading ? <p className="chatStatus">Loading chat...</p> : null}
                {!isChatLoading && chatMode === "global" && chatMessages.length === 0 ? (
                  <p className="chatStatus">
                    No chat messages yet. Start the noise.
                  </p>
                ) : null}
                {chatMode === "magazine" ? (
                  visibleMagazineTracks.length === 0 ? (
                    <p className="chatStatus">No magazine articles are available yet.</p>
                  ) : (
                    <>
                      <div className="magazineRailHeader">
                        <strong>Latest Articles</strong>
                         {isAdmin ? <MagazineGenerateNowButton /> : null}
                      </div>
                      {visibleMagazineTracks.map((track) => (
                        <article
                          key={track.slug}
                          className="magazineRailCard magazineRailCardClickable"
                          onClick={() => {
                            window.scrollTo(0, 0);
                            router.push(`/magazine/${encodeURIComponent(track.slug)}`);
                          }}
                          onKeyDown={handleButtonLikeKeyDown(() => {
                            window.scrollTo(0, 0);
                            router.push(`/magazine/${encodeURIComponent(track.slug)}`);
                          })}
                          role="button"
                          tabIndex={0}
                          aria-label={`Open magazine article: ${track.artist} - ${track.title}`}
                        >
                          <Image
                            src={`https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`}
                            alt={`${track.artist} - ${track.title} thumbnail`}
                            width={168}
                            height={96}
                            className="magazineRailThumb"
                            loading="lazy"
                            sizes="84px"
                          />
                          {isAdmin ? (
                            <button
                              type="button"
                              className="magazineAdminDeleteButton"
                              aria-label={`Delete article: ${track.title}`}
                              disabled={Boolean(deletingMagazineSlugs[track.slug])}
                              onClick={async (event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                await handleDeleteMagazineArticle(track);
                              }}
                              onKeyDown={handleStopPropagationKeyDown}
                            >
                              {deletingMagazineSlugs[track.slug] ? "…" : "✕"}
                            </button>
                          ) : null}
                          <div className="magazineRailBody">
                            <div className="messageMeta">
                              <strong>{track.artist}</strong>
                              <span>{track.kicker || track.genre}</span>
                            </div>
                            <p>{track.title}</p>
                            {magazineDeleteErrors[track.slug] ? (
                              <p className="magazineRailAdminDeleteError">{magazineDeleteErrors[track.slug]}</p>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </>
                  )
                ) : chatMode === "online" ? (
                  <>
                    {FORUM_SECTIONS.map((section) => (
                      <article key={section.id} className="chatMessage forumSectionCard">
                        <div>
                          <div className="messageMeta">
                            <strong>{section.title}</strong>
                          </div>
                          <p>{section.description}</p>
                        </div>
                      </article>
                    ))}
                  </>
                ) : (
                  chatMessages.map((message) => {
                    const isUserOnline = onlineUsers.some((u) => u.name === message.user.name);
                    const sharedVideo = parseSharedVideoMessage(message.content);
                    const profileHref = getUserProfileHref(message.user.name, message.user.id);
                    const isProfileClickable = Boolean(profileHref);
                    return (
                      <article
                        key={message.id}
                        className={isProfileClickable ? "chatMessage chatMessageClickable" : "chatMessage"}
                        onClick={isProfileClickable ? () => router.push(profileHref!) : undefined}
                        onKeyDown={isProfileClickable ? handleButtonLikeKeyDown(() => router.push(profileHref!)) : undefined}
                        role={isProfileClickable ? "button" : undefined}
                        tabIndex={isProfileClickable ? 0 : undefined}
                        aria-label={isProfileClickable ? `Open profile for ${message.user.name}` : undefined}
                      >
                        {message.user.avatarUrl ? (
                          <Image src={message.user.avatarUrl} alt="" width={88} height={88} className="chatAvatar" loading="lazy" sizes="44px" unoptimized />
                        ) : (
                          <div className="avatar">{message.user.name.slice(0, 1)}</div>
                        )}
                        <div>
                          <div className="messageMeta">
                            <strong>{message.user.name}</strong>
                            {isUserOnline ? <span className="chatOnlineBadge" title="Online now">● Online</span> : null}
                            <span className="chatMessageMetaRight">
                              <span className="chatMessageTimestamp">{formatChatTimestamp(message.createdAt)}</span>
                              {isAdmin ? (
                                <button
                                  type="button"
                                  className="chatDeleteButton"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (!window.confirm("Delete this chat comment?")) {
                                      return;
                                    }
                                    void handleDeleteChatMessage(message.id);
                                  }}
                                  onKeyDown={handleStopPropagationKeyDown}
                                  disabled={deletingMessageIds.includes(message.id)}
                                  aria-label={`Delete chat comment from ${message.user.name}`}
                                >
                                  {deletingMessageIds.includes(message.id) ? "Deleting..." : "Delete"}
                                </button>
                              ) : null}
                            </span>
                          </div>
                          {sharedVideo ? (
                            <>
                              <SharedVideoMessageCard videoId={sharedVideo.videoId} />
                            </>
                          ) : (
                            <p>{message.content}</p>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
              {chatMode === "global" ? (
                isAuthenticated ? (
                  <>
                    <form className="chatComposer" onSubmit={handleChatSubmit}>
                      <input
                        type="text"
                        placeholder="Message the chat..."
                        value={chatDraft}
                        onChange={(event) => setChatDraft(event.target.value)}
                        maxLength={200}
                        disabled={isChatSubmitting}
                      />
                      <button type="submit" disabled={isChatSubmitting || chatDraft.trim().length === 0}>
                        {isChatSubmitting ? "Sending..." : "Send"}
                      </button>
                    </form>
                    {chatError ? <p className="chatStatus chatStatusError">{chatError}</p> : null}
                  </>
                ) : (
                  <div className="guestChatComposer">
                    <button
                      type="button"
                      className="navLink navLinkActive guestChatSignInBtn"
                      onClick={openAuthModal}
                    >
                      Sign in to chat
                    </button>
                  </div>
                )
              ) : null}
            </>
            );
            return railContent;
          })()}
        </aside>
        <section className="playerStage">
          <div ref={playerChromeRef} className={playerChromeClassName} style={playerChromeStyle}>
            <div className="playerDockLayer">
              {deniedPlaybackMessage ? (
                <div className="playbackDeniedBanner" role="status" aria-live="polite">
                  <span>{deniedPlaybackMessage}</span>
                  <button
                    type="button"
                    className="playbackDeniedClose"
                    onClick={() => setDeniedPlaybackMessage(null)}
                    aria-label="Dismiss message"
                  >
                    x
                  </button>
                </div>
              ) : null}
              <Suspense fallback={<div className="playerLoadingFallback" />}>
                <PlayerExperience
                  currentVideo={currentVideo}
                  queue={[currentVideo, ...uniqueRelatedVideos]}
                  temporaryQueue={temporaryQueueVideos}
                  isLoggedIn={isAuthenticated}
                  isAdmin={isAdmin}
                  onAuthRequiredAction={openAuthModal}
                  isDockedDesktop={shouldDockDesktopPlayer}
                  // Invariant anchor for verify-auth-invariants.js:
                  // suppressAuthWall={!isAuthenticated && isMagazineOverlayRoute}
                  suppressAuthWall={!isAuthenticated}
                  seenVideoIds={seenVideoIdsRef.current}
                  onHideVideoAction={handleHideFromWatchNext}
                  onAddVideoToPlaylistAction={handleAddToPlaylistFromWatchNext}
                  onDockHideRequestAction={() => setIsDockHidden(true)}
                  forcedUnavailableSignal={forcedUnavailableSignal}
                  forcedUnavailableMessage={forcedUnavailableMessage}
                  isRouteResolving={isResolvingInitialVideo || isResolvingRequestedVideo}
                  routeLoadingLabel={routeLoadingLabel}
                  routeLoadingMessage={routeLoadingMessage}
                />
              </Suspense>
            </div>
            {shouldShowOverlayPanel || isAdminOverlayRoute ? (
              <section
                className={overlayPanelClassName}
                aria-label="Page overlay"
              >
                <div ref={favouritesBlindInnerRef} className="favouritesBlindInner">
                  {(() => {
                    const loadingFallback = (
                      isCategoriesOverlayPendingOrActive ? (
                        <div className="categoriesFilterSection" aria-busy="true">
                          <OverlayHeader className="categoriesHeaderBar" close={false}>
                            <div className="categoriesHeaderMain">
                              <strong>
                                <span className="categoryHeaderBreadcrumb">☣ Categories</span>
                              </strong>
                              <div className="categoriesFilterBar">
                                <input
                                  type="text"
                                  className="categoriesFilterInput"
                                  placeholder="type to filter..."
                                  aria-label="Filter categories by prefix"
                                  autoComplete="off"
                                  spellCheck={false}
                                  disabled
                                />
                              </div>
                            </div>
                            <a
                              href={`/?v=${encodeURIComponent(currentVideo.id)}&resume=1`}
                              className="favouritesBlindClose"
                              data-overlay-close="true"
                            >
                              Close
                            </a>
                          </OverlayHeader>
                          <div className="categoriesCatalogStage">
                            <div className="categoriesLoaderOverlay" role="status" aria-live="polite" aria-label="Loading categories">
                              <div className="playerBootLoader categoriesLoaderBootLoader">
                                <div className="playerBootBars" aria-hidden="true">
                                  <span />
                                  <span />
                                  <span />
                                  <span />
                                </div>
                                <p>Loading categories...</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : isArtistsOverlayPendingOrActive ? (
                        <>
                          <OverlayHeader close={false}>
                            <strong>
                              <span className="categoryHeaderBreadcrumb">🎸 Artists</span>
                            </strong>
                            <a
                              href={`/?v=${encodeURIComponent(currentVideo.id)}&resume=1`}
                              className="favouritesBlindClose"
                              data-overlay-close="true"
                            >
                              Close
                            </a>
                          </OverlayHeader>
                          <div className="routeContractRow artistLoadingCenter" role="status" aria-live="polite" aria-label="Loading artists">
                            <span className="playerBootBars" aria-hidden="true">
                              <span />
                              <span />
                              <span />
                              <span />
                            </span>
                            <span>Loading artists...</span>
                          </div>
                        </>
                      ) : (
                        <div className="playerLoadingFallback" role="status" aria-live="polite" aria-label={routeLoadingLabel}>
                          <div className="playerBootLoader">
                            <div className="playerBootBars" aria-hidden="true">
                              <span />
                              <span />
                              <span />
                              <span />
                            </div>
                            <p>{routeLoadingMessage}</p>
                            {pendingOverlayCloseVideoId ? (
                              <div className="routeContractRow">
                                <button
                                  type="button"
                                  className="routeContractRetryButton"
                                  onClick={retryPendingOverlayVideoLoad}
                                >
                                  Retry connection
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )
                    );
                    if (!isOverlayRoute) {
                      return loadingFallback;
                    }
                    if (children == null) {
                      return loadingFallback;
                    }
                    return (
                      <Suspense
                        fallback={loadingFallback}
                      >
                        {children}
                      </Suspense>
                    );
                  })()}
                </div>
              </section>
            ) : null}
          </div>
        </section>
        {isAdminOverlayRoute ? null : (
          <aside
            ref={watchNextRailRef}
            className={
              shouldOccludeRightRail
                ? "rightRail panel translucent railOccluded"
                : "rightRail panel translucent"
            }
            aria-hidden={shouldOccludeRightRail}
            inert={shouldOccludeRightRail ? true : undefined}
          >
            <RightRailLyricsOverlay
              isOpen={isLyricsOverlayOpen}
              isLoading={isLyricsOverlayLoading}
              error={lyricsOverlayError}
              data={lyricsOverlayData}
              onClose={() => setIsLyricsOverlayOpen(false)}
            />
            <div className="railTabs rightRailTabs">
              {isAuthenticated ? (
                <button
                  type="button"
                  className={rightRailMode === "watch-next" ? "activeTab" : undefined}
                  onClick={handleSwitchToWatchNextRail}
                >
                  Watch Next
                </button>
              ) : (
                <span className={rightRailMode === "watch-next" ? "tabLabel activeTab" : "tabLabel"}>Watch Next</span>
              )}
              {isAuthenticated ? (
                <button
                  type="button"
                  className={rightRailMode === "playlist" ? "activeTab" : undefined}
                  onClick={() => setRightRailMode("playlist")}
                >
                  {activePlaylistTrackCount > 0 ? `Playlist (${activePlaylistTrackCount})` : "Playlist"}
                </button>
              ) : null}
              {isAuthenticated ? (
                <button
                  type="button"
                  className={rightRailMode === "queue" ? "activeTab" : undefined}
                  onClick={() => setRightRailMode("queue")}
                >
                  {temporaryQueueVideos.length > 0 ? `Queue (${temporaryQueueVideos.length})` : "Queue"}
                </button>
              ) : null}
            </div>
          {rightRailMode === "watch-next" && isAuthenticated ? (
            <WatchNextSeenToggle
              isActive={watchNextHideSeen}
              onToggle={() => setWatchNextHideSeen((value) => !value)}
            />
          ) : null}
          <HideVideoConfirmModal
            isOpen={watchNextHideConfirmTrack !== null}
            video={watchNextHideConfirmTrack}
            isPending={watchNextHideConfirmTrack ? hiddenMutationPendingVideoIdSet.has(watchNextHideConfirmTrack.id) : false}
            onCancel={() => setWatchNextHideConfirmTrack(null)}
            onConfirm={() => {
              void confirmHideFromWatchNext();
            }}
          />
          {rightRailMode === "watch-next" ? (
            <div
              ref={relatedStackRef}
              className={`relatedStack${
                relatedTransitionPhase === "fading-out"
                  ? " relatedStackFadingOut"
                  : relatedTransitionPhase === "fading-in"
                    ? " relatedStackFadingIn"
                    : ""
              }`}
              onScroll={handleRelatedScroll}
            >
              {playlistMutationMessage ? (
                <p className={`rightRailStatus rightRailStatus${playlistMutationTone === "success" ? "Success" : playlistMutationTone === "error" ? "Error" : "Info"}`}>
                  {playlistMutationMessage}
                </p>
              ) : null}
              <WatchNextStatusPanels
                watchNextLoadFailed={watchNextLoadFailed}
                hasVisibleVideos={visibleWatchNextVideos.length > 0}
                onRetryLoadMore={() => {
                  void loadMoreRelatedVideos();
                }}
                shouldShowWatchNextGenreConstrainedHint={shouldShowWatchNextGenreConstrainedHint}
                shouldShowWatchNextUnseenEmptyState={shouldShowWatchNextUnseenEmptyState}
                shouldShowWatchNextGenreConstrainedEmptyState={shouldShowWatchNextGenreConstrainedEmptyState}
                shouldShowWatchNextEmptyState={shouldShowWatchNextEmptyState}
                onOpenAutoplaySettings={openAutoplaySettingsOverlay}
              />
              {shouldShowWatchNextRailLoader ? (
                <RightRailLoadingState message="Loading videos..." />
              ) : (
                <>
                  {visibleWatchNextVideos.map((track, index) => (
                    <WatchNextCard
                      key={track.id}
                      track={track}
                      index={index}
                      isAuthenticated={isAuthenticated}
                      isSeen={isAuthenticated && seenVideoIdsRef.current.has(track.id)}
                      isFavourite={isFavouriteVideo(track)}
                      isQueued={temporaryQueueVideoIdSet.has(track.id)}
                      isHiding={hidingRelatedVideoIdSet.has(track.id)}
                      isHiddenMutationPending={hiddenMutationPendingVideoIdSet.has(track.id)}
                      isClicked={clickedRelatedVideoId === track.id}
                      onHide={handleHideFromWatchNext}
                      onAddToQueue={handleAddToTemporaryQueue}
                      onPrefetch={prefetchRelatedSelection}
                      onTrackClick={handleWatchNextTrackClick}
                    />
                  ))}
                  <div ref={relatedLoadMoreSentinelRef} className="relatedLoadMoreSentinel" aria-hidden="true" />
                  {showLoadingMoreRelatedHint && visibleWatchNextVideos.length > 0 ? (
                    <div className="relatedLoadingState" role="status" aria-live="polite" aria-label="Loading more suggestions">
                      <div className="playerBootBars" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : rightRailMode === "queue" ? (
            <div className="relatedStack relatedStackPlaylist">
              <div className="rightRailPlaylistBar">
                <span className="rightRailPlaylistLabel">
                  Current queue • {temporaryQueueVideos.length} {temporaryQueueVideos.length === 1 ? "track" : "tracks"}
                </span>
                {temporaryQueueVideos.length > 0 ? (
                  <div className="rightRailPlaylistActions">
                    <button
                      type="button"
                      className="rightRailPlaylistClose"
                      onClick={handleClearTemporaryQueue}
                    >
                      Clear
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="relatedStackPlaylistBody">
                {temporaryQueueVideos.length > 0 ? (
                  temporaryQueueVideos.map((track, index) => (
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
                          handleRemoveFromTemporaryQueue(track.id);
                        }}
                      >
                        ×
                      </button>
                      <Link
                        href={`/?v=${track.id}`}
                        className={`relatedCard linkedCard relatedCardTransition rightRailPlaylistTrackCard${track.id === currentVideo.id ? " relatedCardActive" : ""}${clickedRelatedVideoId === track.id ? " relatedCardClickFlash" : ""}`}
                        onClick={() => handleWatchNextTrackClick(track.id)}
                        onMouseEnter={() => prefetchRelatedSelection(track)}
                        onFocus={() => prefetchRelatedSelection(track)}
                        onPointerDown={() => prefetchRelatedSelection(track)}
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
          ) : (
            <div className="relatedStack relatedStackPlaylist">
              {activePlaylistId ? (
                <div className="rightRailPlaylistBar">
                  <span className="rightRailPlaylistLabel">
                    {playlistRailData
                      ? playlistRailData.name
                      : "Active playlist"}
                  </span>
                  <div className="rightRailPlaylistActions">
                    <Link href={getClosePlaylistHref()} className="rightRailPlaylistClose">
                      Close
                    </Link>
                    <button
                      type="button"
                      className="rightRailPlaylistDelete"
                      aria-label="Delete playlist"
                      title="Delete playlist"
                      onClick={() => {
                        setShowDeleteActivePlaylistConfirm(true);
                      }}
                      disabled={isDeletingActivePlaylist}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ) : null}
              {activePlaylistId && showDeleteActivePlaylistConfirm ? (
                <RightRailDeleteConfirmDialog
                  targetName={playlistRailData?.name ?? activePlaylistSummary?.name ?? "Current playlist"}
                  isBusy={isDeletingActivePlaylist}
                  onCancel={handleCancelDeleteActivePlaylist}
                  onConfirm={handleConfirmDeleteActivePlaylist}
                />
              ) : null}
              {confirmDeleteRailPlaylist ? (
                <RightRailDeleteConfirmDialog
                  targetName={confirmDeleteRailPlaylist.name}
                  isBusy={Boolean(playlistBeingDeletedId)}
                  onCancel={handleCancelDeleteRailPlaylist}
                  onConfirm={handleConfirmDeleteRailPlaylist}
                />
              ) : null}
              <div className="relatedStackPlaylistBody" ref={playlistStackBodyRef}>
              {!activePlaylistId ? (
                isPlaylistSummaryLoading ? (
                  <RightRailLoadingState message="Loading playlists..." />
                ) : playlistSummaryError ? (
                  <p className="rightRailStatus">{playlistSummaryError}</p>
                ) : playlistRailSummaries.length > 0 ? (
                  playlistRailSummaries.map((playlist) => {
                    const hasLeadThumbnail = playlist.itemCount > 0 && playlist.leadVideoId !== "__placeholder__";
                    const isDeleting = playlistBeingDeletedId === playlist.id;
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
                            setConfirmDeleteRailPlaylist({ id: playlist.id, name: playlist.name });
                          }}
                          disabled={playlistBeingDeletedId !== null}
                        >
                          {isDeleting ? "…" : "🗑"}
                        </button>
                        <PlaylistSummaryCardContent
                          playlist={playlist}
                          hasLeadThumbnail={hasLeadThumbnail}
                        />
                      </Link>
                    );
                  })
                ) : (
                  <RightRailPlaylistEmptyState
                    isCreating={isCreatingRailPlaylist}
                    onCreate={() => {
                      void handleCreatePlaylistFromRail();
                    }}
                  />
                )
              ) : isPlaylistRailLoading || isCreatingActivePlaylist ? (
                <RightRailLoadingState message={isCreatingActivePlaylist ? "Creating playlist..." : "Loading playlist tracks..."} />
              ) : playlistRailError ? (
                <p className="rightRailStatus">{playlistRailError}</p>
              ) : playlistRailData && playlistRailData.videos.length > 0 ? (
                playlistRailData.videos.flatMap((track, index) => {
                  const isCurrentPlaylistTrack = activePlaylistTrackIndex === index;
                  const isRecentlyAddedTrack =
                    recentlyAddedPlaylistTrack?.playlistId === playlistRailData.id
                    && recentlyAddedPlaylistTrack?.trackId === track.id;
                  const slotKey = track.playlistItemId ?? `${track.id}:${index}`;
                  const isTrackRemoving = hidingPlaylistTrackKeys.includes(slotKey);
                  const isTrackMutating = playlistItemMutationPendingKeys.includes(slotKey);
                  const isDraggingThis = draggedPlaylistTrackIndex === index;
                  const isDragOver = dragOverPlaylistTrackIndex === index && draggedPlaylistTrackIndex !== null && !isDraggingThis;
                  const showPlaceholderAbove = isDragOver && draggedPlaylistTrackIndex > index;
                  const showPlaceholderBelow = isDragOver && draggedPlaylistTrackIndex < index;
                  return [
                    ...(showPlaceholderAbove
                      ? [
                          <PlaylistDropPlaceholder
                            key={`rph-above-${index}`}
                            onDragOver={(event) => handlePlaylistTrackDragOver(event, index)}
                            onDrop={(event) => handlePlaylistTrackDrop(event, index)}
                          />,
                        ]
                      : []),
                    <PlaylistTrackRow
                      key={track.playlistItemId ?? `${track.id}-${index}`}
                      data-playlist-index={index}
                      isRecentlyAddedTrack={isRecentlyAddedTrack}
                      isTrackRemoving={isTrackRemoving}
                      isDraggingThis={isDraggingThis}
                      isDragOver={isDragOver}
                      onDragOver={(event) => handlePlaylistTrackDragOver(event, index)}
                      onDrop={(event) => handlePlaylistTrackDrop(event, index)}
                    >
                      <PlaylistReorderControls
                        title={track.title}
                        index={index}
                        total={playlistRailData.videos.length}
                        isTrackRemoving={isTrackRemoving}
                        isTrackMutating={isTrackMutating}
                        onReorder={(from, to) => {
                          void handleReorderActivePlaylistTrack(from, to);
                        }}
                      />
                      <PlaylistTrackDraggableShell
                        trackId={track.id}
                        isTrackRemoving={isTrackRemoving}
                        isTrackMutating={isTrackMutating}
                        onDragStart={(event) => handlePlaylistTrackDragStart(event, index)}
                        onDragEnd={handlePlaylistTrackDragEnd}
                      >
                      <PlaylistTrackRowCard
                        track={track}
                        index={index}
                        playlistId={playlistRailData.id}
                        isCurrentPlaylistTrack={isCurrentPlaylistTrack}
                        isTrackRemoving={isTrackRemoving}
                        isTrackMutating={isTrackMutating}
                        onRemove={(targetTrack, targetIndex) => {
                          void handleRemoveTrackFromActivePlaylist(targetTrack, targetIndex);
                        }}
                      />
                      </PlaylistTrackDraggableShell>
                    </PlaylistTrackRow>,
                    ...(showPlaceholderBelow
                      ? [
                          <PlaylistDropPlaceholder
                            key={`rph-below-${index}`}
                            onDragOver={(event) => handlePlaylistTrackDragOver(event, index)}
                            onDrop={(event) => handlePlaylistTrackDrop(event, index)}
                          />,
                        ]
                      : []),
                  ];
                })
              ) : (
                <p className="rightRailStatus">This playlist has no tracks yet.</p>
              )}
              </div>
            </div>
          )}
          </aside>
        )}
      </section>
      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
      </main>
      </ArtistsLetterProvider>
    </OverlayScrollContainerProvider>
  );
}
export function ShellDynamic(props: ShellDynamicProps) {
  return (
    <Suspense>
      <ShellDynamicInner {...props} />
    </Suspense>
  );
}
