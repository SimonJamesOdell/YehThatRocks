"use client";

import Link from "next/link";
import Image from "next/image";
import { Suspense, memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CSSProperties } from "react";

import { AuthLoginForm } from "@/components/auth-login-form";
import { AuthModal } from "@/components/auth-modal";
import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { ArtistsLetterNav } from "@/components/artists-letter-nav";
import { HideVideoConfirmModal } from "@/components/hide-video-confirm-modal";
import { PlayerExperience } from "@/components/player-experience";
import { SearchResultFavouriteButton } from "@/components/search-result-favourite-button";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import { useTemporaryQueueController } from "@/components/use-temporary-queue-controller";
import { useSeenTogglePreference } from "@/components/use-seen-toggle-preference";
import { useDesktopIntro } from "@/components/use-desktop-intro";
import { usePerformanceMetrics } from "@/components/use-performance-metrics";
import { useSearchAutocomplete, type SearchSuggestion } from "@/components/use-search-autocomplete";
import { useChatState, type ChatMode, type ChatMessage, type OnlineUser } from "@/components/use-chat-state";
import { usePlaylistRail, type RightRailMode, type PlaylistRailVideo, type PlaylistRailPayload, type PlaylistRailSummary } from "@/components/use-playlist-rail";
import { PerformanceDial, SharedVideoMessageCard, WatchNextCard } from "@/components/shell-dynamic-rendering";
import { navItems, type VideoRecord } from "@/lib/catalog";
import { detectAppendOnly, filterSeenFromWatchNext } from "@/components/shell-dynamic-helpers";
import { fetchWithAuthRetry as fetchWithAuthRetryClient } from "@/lib/client-auth-fetch";
import { mutateHiddenVideo } from "@/lib/hidden-video-client-service";
import { trackPageView, trackVideoView } from "@/lib/analytics-client";
import { parseSharedVideoMessage } from "@/lib/chat-shared-video";

if (typeof window !== "undefined") {
  const perfWithPatchState = performance as Performance & {
    __ytrMeasurePatched?: boolean;
  };

  if (!perfWithPatchState.__ytrMeasurePatched) {
    const originalMeasure = performance.measure.bind(performance);
    perfWithPatchState.__ytrMeasurePatched = true;

    performance.measure = ((...args: Parameters<Performance["measure"]>) => {
      try {
        return originalMeasure(...args);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Some browser/React timing paths can emit invalid measure ranges.
        // These failures are non-critical and should not crash route rendering.
        if (
          message.includes("negative time stamp")
          || message.includes("cannot have a negative time stamp")
          || message.includes("Failed to execute 'measure'")
          || message.includes("NotFound")
        ) {
          return undefined as unknown as ReturnType<Performance["measure"]>;
        }

        throw error;
      }
    }) as Performance["measure"];
  }
}

type CurrentVideoResolvePayload = {
  currentVideo?: VideoRecord;
  relatedVideos?: VideoRecord[];
  pending?: boolean;
  denied?: { message?: string; reason?: string; videoId?: string };
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

function formatChatTimestamp(value: string | null) {
  if (!value) {
    return "Now";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Now";
  }

  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
const PENDING_VIDEO_SELECTION_KEY = "ytr:pending-video-selection";
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
const RELATED_FETCH_TIMEOUT_MS = 4_000;
const RELATED_COLD_FETCH_RETRY_ATTEMPTS = 3;
const RELATED_COLD_FETCH_RETRY_BASE_DELAY_MS = 250;
const WATCH_NEXT_HIDE_ANIMATION_MS = 240;
const WATCH_NEXT_HIDE_SEEN_TOGGLE_KEY = "ytr-toggle-hide-seen-watch-next";
const PREFETCH_FAILURE_BASE_BACKOFF_MS = 1_500;
const PREFETCH_FAILURE_MAX_BACKOFF_MS = 20_000;
const PLAYLISTS_UPDATED_EVENT = "ytr:playlists-updated";
const RIGHT_RAIL_MODE_EVENT = "ytr:right-rail-mode";
const PLAYLIST_RAIL_SYNC_EVENT = "ytr:playlist-rail-sync";
const PLAYLIST_CREATION_PROGRESS_EVENT = "ytr:playlist-creation-progress";
const WATCH_HISTORY_UPDATED_EVENT = "ytr:watch-history-updated";
const RIGHT_RAIL_LYRICS_OPEN_EVENT = "ytr:right-rail-lyrics-open";
const OVERLAY_OPEN_REQUEST_EVENT = "ytr:overlay-open-request";
const ADMIN_OVERLAY_ENTER_EVENT = "ytr:admin-overlay-enter";
const DOCK_MOVE_DURATION_MS = 520;
const DOCK_CONTROLS_FADE_DURATION_MS = 220;
const DOCK_CONTROLS_FADE_DELAY_MS = Math.max(0, DOCK_MOVE_DURATION_MS - DOCK_CONTROLS_FADE_DURATION_MS);
const UNDOCK_SETTLE_DURATION_MS = 220;
const FOOTER_REVEAL_DURATION_MS = 240;
// Duration of the primaryActionsReturn CSS animation (must stay in sync with player-actions.css).
const FOOTER_REVEAL_ANIMATION_MS = 180;
// Start the footer fade this many ms after the undock movement begins so it
// finishes right as the video reaches its final position.
const FOOTER_EARLY_REVEAL_DELAY_MS = Math.max(0, DOCK_MOVE_DURATION_MS - FOOTER_REVEAL_ANIMATION_MS - 20);

function isCategoriesOverlayPath(pathname: string) {
  return pathname === "/categories" || pathname.startsWith("/categories/");
}

function isArtistsOverlayPath(pathname: string) {
  return pathname === "/artists" || pathname.startsWith("/artists/");
}

function dedupeVideoList(videos: VideoRecord[]) {
  return videos.filter(
    (video, index, all) => all.findIndex((candidate) => candidate.id === video.id) === index,
  );
}

function matchesPlaylistVideoOrder(a: PlaylistRailVideo[], b: PlaylistRailVideo[]) {
  if (a.length !== b.length) {
    return false;
  }

  for (let index = 0; index < a.length; index += 1) {
    if (a[index]?.id !== b[index]?.id) {
      return false;
    }
  }

  return true;
}

function dedupeRelatedRailVideos(videos: VideoRecord[], currentVideoId: string) {
  return dedupeVideoList(videos).filter((video) => video.id !== currentVideoId);
}

function filterHiddenRelatedVideos(videos: VideoRecord[], hiddenVideoIdSet: Set<string>) {
  if (hiddenVideoIdSet.size === 0) {
    return videos;
  }

  return videos.filter((video) => !hiddenVideoIdSet.has(video.id));
}

function sortVideosBySeen(videos: VideoRecord[], seenVideoIdSet: Set<string>) {
  if (seenVideoIdSet.size === 0) {
    return videos;
  }

  const unseen: VideoRecord[] = [];
  const seen: VideoRecord[] = [];

  for (const video of videos) {
    if (seenVideoIdSet.has(video.id)) {
      seen.push(video);
    } else {
      unseen.push(video);
    }
  }

  return [...unseen, ...seen];
}

function isFavouriteVideo(video: VideoRecord) {
  return Number(video.favourited ?? 0) > 0;
}

function logFlow(event: string, detail?: Record<string, unknown>) {
  if (!FLOW_DEBUG_ENABLED) {
    return;
  }

  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[flow/shell] ${event}${payload}`);
}

function finiteNumberOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finitePercentOrNull(value: number | null | undefined) {
  const numeric = finiteNumberOrNull(value);
  return numeric === null ? null : Math.max(0, Math.min(100, numeric));
}

function isRouteActive(href: string, pathname: string) {
  if (href === pathname) return true;
  // /artists nav item should also highlight for /artist/[slug]
  if (href === "/artists" && pathname.startsWith("/artist/")) return true;
  // all other nav items: highlight for sub-paths
  if (href !== "/" && pathname.startsWith(href + "/")) return true;
  return false;
}

function isProtectedOverlayPath(pathname: string) {
  return pathname === "/favourites"
    || pathname === "/history"
    || pathname === "/account"
    || pathname === "/playlists"
    || pathname.startsWith("/playlists/");
}

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
  const searchParams = useSearchParams();
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
  const initialHydratedRelatedVideos = dedupeRelatedRailVideos(dedupeVideoList(initialRelatedVideos), initialVideo.id);

  const [currentVideo, setCurrentVideo] = useState(initialVideo);
  const [relatedVideos, setRelatedVideos] = useState<VideoRecord[]>(initialHydratedRelatedVideos);
  const [displayedRelatedVideos, setDisplayedRelatedVideos] = useState<VideoRecord[]>(initialHydratedRelatedVideos);
  const [relatedTransitionPhase, setRelatedTransitionPhase] = useState<"idle" | "fading-out" | "loading" | "fading-in">("idle");
  const [isLoadingMoreRelated, setIsLoadingMoreRelated] = useState(false);
  const [showLoadingMoreRelatedHint, setShowLoadingMoreRelatedHint] = useState(false);
  const [hasMoreRelated, setHasMoreRelated] = useState(true);
  const [watchNextLoadFailed, setWatchNextLoadFailed] = useState(false);
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
  const playerChromeRef = useRef<HTMLDivElement | null>(null);
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
  const [pendingOverlayOpenKind, setPendingOverlayOpenKind] = useState<"wiki" | "video" | null>(null);
  const [pendingOverlayRouteKey, setPendingOverlayRouteKey] = useState<string | null>(null);
  const [pendingOverlayCloseVideoId, setPendingOverlayCloseVideoId] = useState<string | null>(null);
  const [pendingOverlayCloseHref, setPendingOverlayCloseHref] = useState<string | null>(null);
  const [startupSelectionRefreshTick, setStartupSelectionRefreshTick] = useState(0);
  const overlayCloseTimeoutRef = useRef<number | null>(null);
  const overlayOpenTimeoutRef = useRef<number | null>(null);
  const footerRevealTimeoutRef = useRef<number | null>(null);
  const footerRevealEarlyTimeoutRef = useRef<number | null>(null);
  const undockSettleTimeoutRef = useRef<number | null>(null);
  const shouldRunFooterRevealRef = useRef(false);
  const earlyFooterRevealFiredRef = useRef(false);
  const dockTransitionTimeoutRef = useRef<number | null>(null);

  const {
    temporaryQueueVideos,
    temporaryQueueVideoIdSet,
    handleAddToTemporaryQueue,
    handleRemoveFromTemporaryQueue,
    handleClearTemporaryQueue,
  } = useTemporaryQueueController(currentVideo.id);

  const isCategoriesRoute = isCategoriesOverlayPath(pathname);
  const isArtistsRoute = pathname === "/artists" || pathname.startsWith("/artist/") || pathname.startsWith("/artists/");
  const previousPathname = previousPathnameRef.current;
  const previousWasCategoriesRoute = previousPathname === "/categories" || previousPathname?.startsWith("/categories/") === true;
  const previousWasArtistsRoute = previousPathname === "/artists"
    || previousPathname?.startsWith("/artist/") === true
    || previousPathname?.startsWith("/artists/") === true;
  const isAdminOverlayRoute = pathname === "/admin";
  const isOverlayRoute = pathname !== "/";
  const shouldShowOverlayPanel = (isOverlayRoute && !isAdminOverlayRoute) || pendingOverlayOpenKind !== null;
  const disableOverlayDropAnimation =
    (isCategoriesRoute && previousWasCategoriesRoute)
    || (isArtistsRoute && previousWasArtistsRoute);
  const isPlayerWidthOverlayRoute =
  pathname === "/new"
    || pathname === "/top100"
    || pathname === "/history"
    || pathname === "/search";
  const overlayPanelClassName = [
    "favouritesBlind",
    disableOverlayDropAnimation ? "favouritesBlindNoDrop" : "",
    isPlayerWidthOverlayRoute ? "favouritesBlindPlayerWidth" : "",
    isOverlayClosing ? "favouritesBlindClosing" : "",
  ].filter(Boolean).join(" ");
  const isMagazineOverlayRoute = pathname === "/magazine" || pathname.startsWith("/magazine/");
  const shouldHidePlayerForMagazineGuest = !isAuthenticated && isMagazineOverlayRoute && didArriveOnMagazineRouteRef.current;
  const shouldDisableRelatedRailTransition = pathname === "/new";
  const shouldOccludeLeftRail = shouldShowOverlayPanel && !isMagazineOverlayRoute;
  const shouldOccludeRightRail = shouldShowOverlayPanel && !isMagazineOverlayRoute && pathname !== "/new";
  const isWaitingForClientHydration = !hasClientMounted;
  const isWaitingForStartupVideoUrlSync =
    !requestedVideoId
    && startupHydratedVideoIdRef.current !== null;
  const isWatchNextVideoSelectionPending =
    isWaitingForClientHydration
    || isWaitingForStartupVideoUrlSync
    || isResolvingInitialVideo
    || isResolvingRequestedVideo
    || Boolean(requestedVideoId && startupHydratedVideoIdRef.current === requestedVideoId)
    || Boolean(requestedVideoId && requestedVideoId !== currentVideo.id);
  const isArtistsIndexRoute = pathname === "/artists";
  const shouldDockDesktopPlayer = shouldShowOverlayPanel && !isMagazineOverlayRoute;
  const shouldDockUnderArtistsAlphabet = shouldDockDesktopPlayer && isArtistsIndexRoute;
  const shouldKeepDockedDesktopPresentation = shouldDockDesktopPlayer || isOverlayClosing || isUndockSettling;
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
    chatError, isChatLoading, isChatSubmitting,
    flashingChatTabs, chatListRef, latestMagazineTracks,
    handleChatSubmit,
  } = useChatState({
    initialPathname: pathname,
    isAuthenticated,
    isMagazineOverlayRoute,
    isAdminOverlayRoute,
    shouldShowOverlayPanel: shouldShowOverlayPanel && pathname !== "/new",
    fetchWithAuthRetry,
    checkAuthState,
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

  useEffect(() => {
    setHasClientMounted(true);
  }, []);

  useEffect(() => {
    previousPathnameRef.current = pathname;
  }, [pathname]);

  // Analytics: fire page_view on initial load and every route path change.
  const analyticsLastPathnameRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pathname || analyticsLastPathnameRef.current === pathname) {
      return;
    }

    analyticsLastPathnameRef.current = pathname;
    void trackPageView();
  }, [pathname]);

  // Analytics: fire video_view each time the active video changes
  const analyticsLastVideoIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeVideoId && activeVideoId !== analyticsLastVideoIdRef.current) {
      analyticsLastVideoIdRef.current = activeVideoId;
      void trackVideoView(activeVideoId);
    }
  }, [activeVideoId]);

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
  const retryPendingOverlayVideoLoad = useCallback(() => {
    if (!pendingOverlayCloseVideoId) {
      return;
    }

    const retryHref = pendingOverlayCloseHref ?? `/?v=${encodeURIComponent(pendingOverlayCloseVideoId)}&resume=1`;
    setPendingOverlayOpenKind("video");
    router.replace(retryHref);
    router.refresh();
  }, [pendingOverlayCloseHref, pendingOverlayCloseVideoId, router]);
  const isLeftRailSuppressed = shouldOccludeLeftRail || isMobileCommunityCollapsed;
  const artistLetterParam = searchParams.get("letter");
  const activeArtistLetter =
    artistLetterParam && /^[A-Za-z]$/.test(artistLetterParam)
      ? artistLetterParam.toUpperCase()
      : "A";
  const resumeParam = searchParams.get("resume") ?? undefined;
  const overlayRouteKey = (() => {
    if (pendingOverlayRouteKey) {
      return pendingOverlayRouteKey;
    }

    if (disableOverlayDropAnimation && isCategoriesRoute) {
      return "categories-overlay";
    }

    const filteredParams = new URLSearchParams();

    for (const [key, value] of searchParams.entries()) {
      if (key === "v" || key === "resume" || (pathname === "/admin" && key === "tab")) {
        continue;
      }

      filteredParams.append(key, value);
    }

    const filteredQuery = filteredParams.toString();
    return filteredQuery ? `${pathname}?${filteredQuery}` : pathname;
  })();
  const isCategoriesOverlayPendingOrActive = isCategoriesRoute
    || pendingOverlayRouteKey === "categories-overlay"
    || pendingOverlayRouteKey?.startsWith("/categories") === true;
  const isArtistsOverlayPendingOrActive = isArtistsOverlayPath(pathname)
    || pendingOverlayRouteKey === "artists-overlay"
    || pendingOverlayRouteKey?.startsWith("/artists") === true;
  const routeLoadingLabel = pathname.endsWith("/wiki") || pendingOverlayOpenKind === "wiki" ? "Loading wiki" : "Loading video";
  const routeLoadingMessage = routeLoadingLabel === "Loading video"
    ? "connecting to upstream video provider..."
    : `${routeLoadingLabel}...`;

  const handleOverlayVideoLinkClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!shouldShowOverlayPanel || isOverlayClosing) {
      return;
    }

    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return;
    }

    const target = event.target as Element | null;
    const anchor = target?.closest("a") as HTMLAnchorElement | null;
    if (!anchor) {
      return;
    }

    if (anchor.dataset.overlayClose === "true") {
      const closeHref = anchor.getAttribute("href") ?? "/";
      event.preventDefault();
      window.dispatchEvent(new CustomEvent("ytr:overlay-close-request", {
        detail: { href: closeHref },
      }));
      return;
    }

    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== "/") {
      return;
    }

    const targetVideoId = url.searchParams.get("v");
    if (!targetVideoId) return;

    if (pathname === "/new" && target?.closest(".rightRail")) {
      event.preventDefault();
      url.searchParams.delete("resume");
      window.dispatchEvent(new CustomEvent("ytr:overlay-close-request", { detail: { href: `${url.pathname}${url.search}${url.hash}` } }));
      return;
    }

    event.preventDefault();

    const params = new URLSearchParams(searchParams.toString());
    params.set("v", targetVideoId);
    params.delete('resume');

    const nextQuery = params.toString();
    router.push(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [isOverlayClosing, pathname, router, searchParams, shouldShowOverlayPanel]);

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
    if (!isAdminOverlayRoute) {
      return;
    }

    setChatMode("global");
  }, [isAdminOverlayRoute]);

  useEffect(() => {
    if (!isMagazineOverlayRoute) {
      return;
    }

    setChatMode("magazine");
  }, [isMagazineOverlayRoute]);

  useEffect(() => {
    if (typeof window === "undefined" || !isAdminOverlayRoute) {
      return;
    }

    window.dispatchEvent(new Event(ADMIN_OVERLAY_ENTER_EVENT));
  }, [isAdminOverlayRoute]);

  useEffect(() => {
    if (shouldShowOverlayPanel) {
      if (typeof window !== "undefined" && undockSettleTimeoutRef.current !== null) {
        window.clearTimeout(undockSettleTimeoutRef.current);
        undockSettleTimeoutRef.current = null;
      }
      if (typeof window !== "undefined" && footerRevealTimeoutRef.current !== null) {
        window.clearTimeout(footerRevealTimeoutRef.current);
        footerRevealTimeoutRef.current = null;
      }
      if (typeof window !== "undefined" && footerRevealEarlyTimeoutRef.current !== null) {
        window.clearTimeout(footerRevealEarlyTimeoutRef.current);
        footerRevealEarlyTimeoutRef.current = null;
      }
      // Release any height lock so docking can size freely.
      if (playerChromeRef.current) {
        playerChromeRef.current.style.height = "";
      }
      setIsUndockSettling(false);
      setIsFooterRevealActive(false);
      earlyFooterRevealFiredRef.current = false;
      setIsMobileCommunityOpen(false);
      return;
    }

    setIsOverlayClosing(false);

    if (!shouldRunFooterRevealRef.current) {
      setIsUndockSettling(false);
      setIsFooterRevealActive(false);
      return;
    }

    shouldRunFooterRevealRef.current = false;
    setIsUndockSettling(true);
    // Do not reset isFooterRevealActive here — the early reveal timer may have
    // already started it during the movement animation. We only reset if the
    // early reveal did not fire (see fallback path below).

    // Lock the player chrome height now so that layout changes during the
    // settle/footer-reveal window (e.g. primaryActions entering the flow) cannot
    // cause a visible reflow.  We measure before the state flush so we get the
    // height that the animation left the chrome at.
    const chrome = playerChromeRef.current;
    if (chrome) {
      const lockedHeight = chrome.getBoundingClientRect().height;
      chrome.style.height = `${lockedHeight}px`;
    }

    if (typeof window !== "undefined") {
      if (undockSettleTimeoutRef.current !== null) {
        window.clearTimeout(undockSettleTimeoutRef.current);
      }

      if (footerRevealTimeoutRef.current !== null) {
        window.clearTimeout(footerRevealTimeoutRef.current);
        footerRevealTimeoutRef.current = null;
      }

      undockSettleTimeoutRef.current = window.setTimeout(() => {
        setIsUndockSettling(false);
        undockSettleTimeoutRef.current = null;

        if (earlyFooterRevealFiredRef.current) {
          // Early reveal already ran during the movement animation — the footer
          // animation has completed. Just release the height lock.
          earlyFooterRevealFiredRef.current = false;
          setIsFooterRevealActive(false);
          if (chrome) {
            chrome.style.height = "";
          }
        } else {
          // Fallback: early reveal timer was cancelled or didn't fire (e.g. the
          // overlay was closed very quickly). Trigger the reveal now.
          setIsFooterRevealActive(true);
          footerRevealTimeoutRef.current = window.setTimeout(() => {
            setIsFooterRevealActive(false);
            footerRevealTimeoutRef.current = null;
            // Release the height lock after the footer has fully faded in.
            if (chrome) {
              chrome.style.height = "";
            }
          }, FOOTER_REVEAL_DURATION_MS);
        }
      }, UNDOCK_SETTLE_DURATION_MS);
    }
  }, [shouldShowOverlayPanel]);

  useEffect(() => {
    if (pathname !== "/" && pendingOverlayOpenKind !== null) {
      setPendingOverlayOpenKind(null);
    }
  }, [pathname, pendingOverlayOpenKind]);

  useEffect(() => {
    if (!pendingOverlayCloseVideoId) {
      return;
    }

    if (pathname !== "/") {
      setPendingOverlayCloseVideoId(null);
      setPendingOverlayCloseHref(null);
      return;
    }

    if (
      requestedVideoId !== pendingOverlayCloseVideoId
      || currentVideo.id !== pendingOverlayCloseVideoId
      || isResolvingInitialVideo
      || isResolvingRequestedVideo
    ) {
      return;
    }

    setPendingOverlayCloseVideoId(null);
    setPendingOverlayCloseHref(null);
    setPendingOverlayOpenKind(null);
  }, [
    currentVideo.id,
    isResolvingInitialVideo,
    isResolvingRequestedVideo,
    pathname,
    pendingOverlayCloseVideoId,
    requestedVideoId,
  ]);

  useEffect(() => {
    if (!pendingOverlayRouteKey || pathname === "/") {
      return;
    }

    setPendingOverlayRouteKey(null);
  }, [pathname, pendingOverlayRouteKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleOverlayOpenRequest = (event: Event) => {
      const openEvent = event as CustomEvent<{ href?: string; kind?: string }>;
      const href = openEvent.detail?.href;
      if (!href) {
        return;
      }

      const openUrl = new URL(href, window.location.origin);
      if (openUrl.origin !== window.location.origin) {
        return;
      }

      const kind = openEvent.detail?.kind === "wiki" || openUrl.pathname.endsWith("/wiki") ? "wiki" : "video";
      setPendingOverlayOpenKind(kind);

      const optimisticRouteKey = (() => {
        if (isCategoriesOverlayPath(openUrl.pathname) && isCategoriesRoute) {
          return "categories-overlay";
        }

        const inputParams = new URLSearchParams(openUrl.search);
        const filteredParams = new URLSearchParams();

        for (const [key, value] of inputParams.entries()) {
          if (key === "v" || key === "resume" || (openUrl.pathname === "/admin" && key === "tab")) {
            continue;
          }

          filteredParams.append(key, value);
        }

        const filteredQuery = filteredParams.toString();
        return filteredQuery ? `${openUrl.pathname}?${filteredQuery}` : openUrl.pathname;
      })();

      setPendingOverlayRouteKey(optimisticRouteKey);

      const node = favouritesBlindInnerRef.current;
      if (node) {
        node.scrollTop = 0;
      }

      if (overlayOpenTimeoutRef.current !== null) {
        window.clearTimeout(overlayOpenTimeoutRef.current);
      }

      overlayOpenTimeoutRef.current = window.setTimeout(() => {
        overlayOpenTimeoutRef.current = null;
        setPendingOverlayOpenKind((current) => (pathname === "/" ? null : current));
        setPendingOverlayRouteKey((current) => (pathname === "/" ? null : current));
      }, 4500);
    };

    window.addEventListener(OVERLAY_OPEN_REQUEST_EVENT, handleOverlayOpenRequest);
    return () => {
      window.removeEventListener(OVERLAY_OPEN_REQUEST_EVENT, handleOverlayOpenRequest);
      if (overlayOpenTimeoutRef.current !== null) {
        window.clearTimeout(overlayOpenTimeoutRef.current);
        overlayOpenTimeoutRef.current = null;
      }
      setPendingOverlayRouteKey(null);
    };
  }, [pathname]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleOverlayCloseRequest = (event: Event) => {
      const closeEvent = event as CustomEvent<{ href?: string }>;
      const href = closeEvent.detail?.href;
      if (!href) {
        return;
      }

      const closeUrl = new URL(href, window.location.origin);
      if (closeUrl.origin !== window.location.origin) {
        window.location.assign(closeUrl.toString());
        return;
      }

      const fallbackHomeHref = `/?v=${encodeURIComponent(currentVideo.id)}&resume=1`;
      const nextHref = closeUrl.pathname === "/"
        ? `${closeUrl.pathname}${closeUrl.search}${closeUrl.hash}`
        : fallbackHomeHref;
      const targetVideoId = closeUrl.pathname === "/" ? closeUrl.searchParams.get("v") : null;
      const shouldHoldOverlayForVideoSwitch = Boolean(targetVideoId && targetVideoId !== currentVideo.id);

      if (shouldHoldOverlayForVideoSwitch && targetVideoId) {
        setPendingOverlayOpenKind("video");
        setPendingOverlayCloseVideoId(targetVideoId);
        setPendingOverlayCloseHref(nextHref);
      } else {
        setPendingOverlayCloseVideoId(null);
        setPendingOverlayCloseHref(null);
      }

      if (!shouldShowOverlayPanel || isMagazineOverlayRoute) {
        setIsOverlayClosing(false);
        shouldRunFooterRevealRef.current = false;
        setIsUndockSettling(false);
        setIsFooterRevealActive(false);
        router.push(nextHref);
        return;
      }

      if (overlayCloseTimeoutRef.current !== null) {
        window.clearTimeout(overlayCloseTimeoutRef.current);
        overlayCloseTimeoutRef.current = null;
      }

      setIsOverlayClosing(true);
      shouldRunFooterRevealRef.current = true;
      earlyFooterRevealFiredRef.current = false;
      const shouldNavigateDuringCloseAnimation = pathname === "/new" && shouldHoldOverlayForVideoSwitch;

      // Schedule the footer reveal to start early so it completes as the undock animation finishes.
      if (footerRevealEarlyTimeoutRef.current !== null) {
        window.clearTimeout(footerRevealEarlyTimeoutRef.current);
      }
      footerRevealEarlyTimeoutRef.current = window.setTimeout(() => {
        footerRevealEarlyTimeoutRef.current = null;
        earlyFooterRevealFiredRef.current = true;
        setIsFooterRevealActive(true);
      }, FOOTER_EARLY_REVEAL_DELAY_MS);

      const frame = playerChromeRef.current?.querySelector(".playerFrame, .playerLoadingFallback") as HTMLElement | null;
      let didNavigate = false;
      const finishCloseNavigation = () => {
        if (didNavigate) {
          return;
        }

        didNavigate = true;
        if (overlayCloseTimeoutRef.current !== null) {
          window.clearTimeout(overlayCloseTimeoutRef.current);
          overlayCloseTimeoutRef.current = null;
        }

        router.push(nextHref);
      };

      if (shouldNavigateDuringCloseAnimation) {
        finishCloseNavigation();
        return;
      }

      const handleFrameTransitionEnd = (transitionEvent: TransitionEvent) => {
        if (transitionEvent.propertyName !== "transform") {
          return;
        }

        if (frame && transitionEvent.target !== frame) {
          return;
        }

        frame?.removeEventListener("transitionend", handleFrameTransitionEnd);
        finishCloseNavigation();
      };

      frame?.addEventListener("transitionend", handleFrameTransitionEnd);
      overlayCloseTimeoutRef.current = window.setTimeout(() => {
        frame?.removeEventListener("transitionend", handleFrameTransitionEnd);
        finishCloseNavigation();
      }, DOCK_MOVE_DURATION_MS + 120);
    };

    const handleDockHideRequest = () => {
      setIsDockHidden(true);
    };

    window.addEventListener("ytr:overlay-close-request", handleOverlayCloseRequest);
    window.addEventListener("ytr:dock-hide-request", handleDockHideRequest);
    return () => {
      window.removeEventListener("ytr:overlay-close-request", handleOverlayCloseRequest);
      window.removeEventListener("ytr:dock-hide-request", handleDockHideRequest);
      if (overlayCloseTimeoutRef.current !== null) {
        window.clearTimeout(overlayCloseTimeoutRef.current);
        overlayCloseTimeoutRef.current = null;
      }

      if (footerRevealTimeoutRef.current !== null) {
        window.clearTimeout(footerRevealTimeoutRef.current);
        footerRevealTimeoutRef.current = null;
      }

      if (footerRevealEarlyTimeoutRef.current !== null) {
        window.clearTimeout(footerRevealEarlyTimeoutRef.current);
        footerRevealEarlyTimeoutRef.current = null;
      }

      if (undockSettleTimeoutRef.current !== null) {
        window.clearTimeout(undockSettleTimeoutRef.current);
        undockSettleTimeoutRef.current = null;
      }

      setIsFooterRevealActive(false);
      setIsUndockSettling(false);
      shouldRunFooterRevealRef.current = false;
      earlyFooterRevealFiredRef.current = false;
    };
  }, [currentVideo.id, isMagazineOverlayRoute, pathname, router, shouldShowOverlayPanel]);

  useEffect(() => {
    if (requestedVideoId) {
      setIsDockHidden(false);
    }
  }, [requestedVideoId]);

  useEffect(() => {
    // If the user moves between overlay routes (e.g. /new -> /top100),
    // ensure a previously hidden docked player becomes visible again.
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
        logFlow("startup-selection:skipped", {
          source,
          nextVideoId,
          cancelled,
        });
        return;
      }

      window.sessionStorage.setItem(LAST_RANDOM_START_VIDEO_ID_KEY, nextVideoId);
      logFlow("startup-selection:navigate", {
        source,
        nextVideoId,
        previousVideoId,
      });
      router.replace(`${pathname}?${new URLSearchParams({ ...Object.fromEntries(searchParams.entries()), v: nextVideoId }).toString()}`);
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
    logFlow("startup-selection:server-initial", {
      selectedVideoId: initialVideo.id,
      relatedCount: initialHydratedRelatedVideos.length,
    });
    resolveStartupCandidate(initialVideo, initialHydratedRelatedVideos, "server-initial");

    return () => {
      cancelled = true;
    };
  }, [initialHydratedRelatedVideos, initialVideo, pathname, requestedVideoId, router, searchParamsKey, startupSelectionRefreshTick]);

  useEffect(() => {
    logFlow("requested-video:effect", {
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

        logFlow("requested-video:response", {
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
          setIsResolvingRequestedVideo(false);
          if (!hasResolvedInitialVideoRef.current) {
            hasResolvedInitialVideoRef.current = true;
            setIsResolvingInitialVideo(false);
          }
          return;
        }

        if (data?.pending) {
          logFlow("requested-video:pending", {
            requestedVideoId,
            attempt,
          });
        }
      } catch (error) {
        if (ignore) {
          return;
        }

        logFlow("requested-video:error", {
          requestedVideoId,
          error: error instanceof Error ? error.message : String(error),
          attempt,
        });
      }

      if (ignore) {
        return;
      }

      if (attempt >= REQUESTED_VIDEO_RETRY_MAX_ATTEMPTS) {
        logFlow("requested-video:halted", {
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
          const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
          setLyricsOverlayData(null);
          setLyricsOverlayError(errorPayload?.error ?? `Could not fetch lyrics right now (HTTP ${response.status}).`);
          return;
        }

        const payload = (await response.json().catch(() => null)) as LyricsRailPayload | null;

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

  const sourceRelatedVideos = useMemo(() => dedupeVideoList(relatedVideos), [relatedVideos]);
  const uniqueRelatedVideos = useMemo(() => filterHiddenRelatedVideos(
    dedupeRelatedRailVideos(sourceRelatedVideos, currentVideo.id),
    hiddenVideoIdsRef.current,
  ), [currentVideo.id, sourceRelatedVideos]);
  const displayedRenderableRelatedVideos = useMemo(() => filterHiddenRelatedVideos(
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

  const activePlaylistSummary = activePlaylistId
    ? playlistRailSummaries.find((playlist) => playlist.id === activePlaylistId) ?? null
    : null;

  const loadMoreRelatedVideos = useCallback(async (requestedCount = RELATED_LOAD_BATCH_SIZE) => {
    if (
      relatedLoadInFlightRef.current
      || !hasMoreRelated
      || rightRailMode !== "watch-next"
      || isWatchNextVideoSelectionPending
    ) {
      return;
    }

    if (dedupeRelatedRailVideos(dedupeVideoList(relatedVideosRef.current), currentVideo.id).length >= RELATED_MAX_VIDEOS) {
      setHasMoreRelated(false);
      return;
    }

    relatedLoadInFlightRef.current = true;
    setIsLoadingMoreRelated(true);
    setWatchNextLoadFailed(false);

    try {
      const existing = dedupeRelatedRailVideos(dedupeVideoList(relatedVideosRef.current), currentVideo.id);
      const isFirstColdFetch = relatedFetchOffsetRef.current === null && existing.length === 0;
      if (relatedFetchOffsetRef.current === null || relatedFetchOffsetRef.current < existing.length) {
        relatedFetchOffsetRef.current = existing.length;
      }
      const batchCount = Math.max(1, Math.min(30, Math.floor(requestedCount)));
      const requestedBatchCount = Math.max(1, Math.min(40, Math.floor(requestedCount)));

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

      const tryFetchPayload = async () => {
        const abortController = new AbortController();
        const timeoutId = window.setTimeout(() => {
          abortController.abort();
        }, RELATED_FETCH_TIMEOUT_MS);

        try {
          const response = await fetch(`/api/current-video?${params.toString()}`, {
            cache: "no-store",
            signal: abortController.signal,
          });

          if (!response.ok) {
            throw new Error("watch-next-load-failed");
          }

          const json = (await response.json()) as CurrentVideoResolvePayload & { hasMore?: boolean };

          // If server is busy (timeout/cooldown), { pending: true } is retryable, not a silent fail.
          if (json && typeof json === "object" && "pending" in json && (json as { pending?: boolean }).pending) {
            throw new Error("watch-next-server-busy");
          }

          return json;
        } finally {
          window.clearTimeout(timeoutId);
        }
      };

      let payload: (CurrentVideoResolvePayload & { hasMore?: boolean }) | null = null;
      const maxAttempts = isFirstColdFetch ? RELATED_COLD_FETCH_RETRY_ATTEMPTS : 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          payload = await tryFetchPayload();
          break;
        } catch {
          if (attempt >= maxAttempts) {
            throw new Error("watch-next-load-exhausted");
          }

          const retryDelayMs = Math.min(3_000, RELATED_COLD_FETCH_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1)));
          await new Promise<void>((resolve) => {
            window.setTimeout(() => {
              resolve();
            }, retryDelayMs);
          });
        }
      }

      if (!payload) {
        throw new Error("watch-next-load-empty-payload");
      }

      const resolvedPayload = payload;
      const nextVideos = Array.isArray(resolvedPayload.relatedVideos) ? resolvedPayload.relatedVideos : [];
      const payloadHasMore = resolvedPayload.hasMore !== false;
      relatedFetchOffsetRef.current = (relatedFetchOffsetRef.current ?? existing.length) + nextVideos.length;
      watchNextAutoRecoverAttemptRef.current = 0;

      if (nextVideos.length === 0 && !payloadHasMore) {
        setHasMoreRelated(false);
        return;
      }

      startTransition(() => {
        setRelatedVideos((previous) => {
          const merged = dedupeRelatedRailVideos(dedupeVideoList([...previous, ...nextVideos]), currentVideo.id)
            .slice(0, RELATED_MAX_VIDEOS);
          return merged;
        });
      });

      if (!payloadHasMore) {
        setHasMoreRelated(false);
        return;
      }

    } catch {
      const existingAfterFailure = dedupeRelatedRailVideos(dedupeVideoList(relatedVideosRef.current), currentVideo.id);
      if (existingAfterFailure.length === 0) {
        // Reset the offset back to null so the next attempt (auto-recover or manual)
        // is treated as a fresh cold-start and gets the full retry budget.
        relatedFetchOffsetRef.current = null;
        setWatchNextLoadFailed(true);
      }
    } finally {
      relatedLoadInFlightRef.current = false;
      setIsLoadingMoreRelated(false);
    }
  }, [currentVideo.id, hasMoreRelated, isWatchNextVideoSelectionPending, rightRailMode]);

  useEffect(() => {
    // Cold-start trigger: fire the first Watch Next fetch as soon as selection is
    // settled and the rail is still empty. Other triggers guard on idle phase,
    // while an empty rail is often in "loading" phase.
    if (
      isWatchNextVideoSelectionPending
      || rightRailMode !== "watch-next"
      || !hasMoreRelated
      || relatedVideos.length > 0
    ) {
      return;
    }

    void loadMoreRelatedVideos();
  }, [hasMoreRelated, isWatchNextVideoSelectionPending, loadMoreRelatedVideos, relatedVideos.length, rightRailMode]);

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
    setHasBootstrappedWatchNext(false);
    setIsLoadingMoreRelated(false);
    setShowLoadingMoreRelatedHint(false);
    setHasMoreRelated(true);
    setWatchNextLoadFailed(false);
  }, [currentVideo.id]);

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

    const timeoutId = window.setTimeout(() => {
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

  const prewarmRelatedThumbnail = useCallback((videoId: string) => {
    if (typeof window === "undefined") {
      return;
    }

    if (prewarmedThumbnailIdsRef.current.has(videoId)) {
      return;
    }

    prewarmedThumbnailIdsRef.current.add(videoId);
    const img = new window.Image();
    img.decoding = "async";
    img.src = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
  }, []);

  const prefetchCurrentVideoPayload = useCallback((videoId: string) => {
    if (Date.now() < prefetchBlockedUntilRef.current) {
      return;
    }

    const cached = prefetchedCurrentVideoPayloadRef.current.get(videoId);
    if (cached && cached.expiresAt > Date.now()) {
      return;
    }

    if (inFlightCurrentVideoPrefetchRef.current.has(videoId)) {
      return;
    }

    inFlightCurrentVideoPrefetchRef.current.add(videoId);
    const prefetchParams = new URLSearchParams();
    prefetchParams.set("v", videoId);
    if (isAuthenticated && watchNextHideSeen) {
      prefetchParams.set("hideSeen", "1");
    }

    void fetch(`/api/current-video?${prefetchParams.toString()}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          prefetchFailureCountRef.current = Math.min(prefetchFailureCountRef.current + 1, 6);
          const backoffMs = Math.min(
            PREFETCH_FAILURE_MAX_BACKOFF_MS,
            PREFETCH_FAILURE_BASE_BACKOFF_MS * (2 ** prefetchFailureCountRef.current),
          );
          prefetchBlockedUntilRef.current = Date.now() + backoffMs;
          return;
        }

        const data = (await response.json()) as CurrentVideoResolvePayload;
        if (!data.currentVideo?.id) {
          prefetchFailureCountRef.current = Math.min(prefetchFailureCountRef.current + 1, 6);
          const backoffMs = Math.min(
            PREFETCH_FAILURE_MAX_BACKOFF_MS,
            PREFETCH_FAILURE_BASE_BACKOFF_MS * (2 ** prefetchFailureCountRef.current),
          );
          prefetchBlockedUntilRef.current = Date.now() + backoffMs;
          return;
        }

        if (data.currentVideo.id === videoId) {
          prefetchFailureCountRef.current = 0;
          prefetchBlockedUntilRef.current = 0;
          prefetchedCurrentVideoPayloadRef.current.set(videoId, {
            expiresAt: Date.now() + CURRENT_VIDEO_PREFETCH_TTL_MS,
            payload: data,
          });

          for (const related of (data.relatedVideos ?? []).slice(0, 6)) {
            prewarmRelatedThumbnail(related.id);
          }
        }
      })
      .catch(() => {
        prefetchFailureCountRef.current = Math.min(prefetchFailureCountRef.current + 1, 6);
        const backoffMs = Math.min(
          PREFETCH_FAILURE_MAX_BACKOFF_MS,
          PREFETCH_FAILURE_BASE_BACKOFF_MS * (2 ** prefetchFailureCountRef.current),
        );
        prefetchBlockedUntilRef.current = Date.now() + backoffMs;
      })
      .finally(() => {
        inFlightCurrentVideoPrefetchRef.current.delete(videoId);
      });
  }, [isAuthenticated, prewarmRelatedThumbnail, watchNextHideSeen]);

  const prefetchRelatedSelection = useCallback((video: VideoRecord) => {
    prewarmRelatedThumbnail(video.id);

    if (!prefetchedRelatedIdsRef.current.has(video.id)) {
      prefetchedRelatedIdsRef.current.add(video.id);
      prefetchCurrentVideoPayload(video.id);
    }

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
  }, [prefetchCurrentVideoPayload, prewarmRelatedThumbnail]);

  useEffect(() => {
    for (const video of displayedRelatedVideos.slice(0, 6)) {
      prewarmRelatedThumbnail(video.id);
    }
  }, [displayedRelatedVideos]);

  useEffect(() => {
    if (isOverlayRoute) {
      return;
    }

    const topTargets = sourceRelatedVideos
      .filter((video) => video.id !== currentVideo.id)
      .slice(0, 3);
    if (topTargets.length === 0) {
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      for (const target of topTargets) {
        prefetchCurrentVideoPayload(target.id);
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [currentVideo.id, isOverlayRoute, sourceRelatedVideos]);

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
  const visibleNavItems = navItems.filter((item) => item.href !== "/" && item.href !== "/ai");

  const protectedNavHrefs = new Set(["/favourites", "/playlists", "/history", "/account"]);

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  function openAuthModal() {
    setIsAuthModalOpen(true);
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleAuthSuccess = () => {
      setIsAuthenticated(true);
      setAuthStatus("clear");
      setAuthStatusMessage(null);
      setIsAuthModalOpen(false);
    };

    window.addEventListener("ytr:auth-success", handleAuthSuccess);

    return () => {
      window.removeEventListener("ytr:auth-success", handleAuthSuccess);
    };
  }, []);

  function getNavHref(href: string) {
    const params = new URLSearchParams();
    params.set("v", currentVideo.id);
    params.set("resume", "1");

    if (href === "/artists") {
      params.set("letter", activeArtistLetter);
    }

    return `${href}?${params.toString()}`;
  }

  function requestOverlayOpen(href: string, kind: "video" | "wiki" = "video") {
    if (typeof window === "undefined") {
      return;
    }

    window.dispatchEvent(new CustomEvent(OVERLAY_OPEN_REQUEST_EVENT, {
      detail: { href, kind },
    }));
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const targetHrefs = visibleNavItems
      .filter((item) => !isRouteActive(item.href, pathname))
      .map((item) => getNavHref(item.href));

    if (targetHrefs.length === 0) {
      return;
    }

    let cancelled = false;
    let idleId: number | null = null;

    const requestIdle = (window as Window & {
      requestIdleCallback?: (callback: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }).requestIdleCallback;
    const cancelIdle = (window as Window & {
      requestIdleCallback?: (callback: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }).cancelIdleCallback;

    const warmRoutes = () => {
      if (cancelled) {
        return;
      }

      for (const href of targetHrefs) {
        router.prefetch(href);
      }
    };

    const timeoutId = window.setTimeout(() => {
      if (typeof requestIdle === "function") {
        idleId = requestIdle(() => {
          warmRoutes();
        }, { timeout: 1500 });
        return;
      }

      warmRoutes();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      if (idleId !== null && typeof cancelIdle === "function") {
        cancelIdle(idleId);
      }
    };
  }, [activeArtistLetter, currentVideo.id, pathname, router, visibleNavItems]);

  const shellClassName = [
    shouldShowOverlayPanel ? "shell shellOverlayRoute" : "shell",
    isDesktopIntroPreload ? "shellDesktopIntroPreload" : "",
    isDesktopIntroActive ? "shellDesktopIntroActive" : "",
    desktopIntroPhase === "moving" ? "shellDesktopIntroMoving" : "",
    desktopIntroPhase === "revealing" ? "shellDesktopIntroRevealing" : "",
  ].filter(Boolean).join(" ");

  const shellStyle = isDesktopIntroActive
    ? ({
      "--desktop-intro-dx": `${desktopIntroDeltaX}px`,
      "--desktop-intro-dy": `${desktopIntroDeltaY}px`,
      "--desktop-intro-scale": String(desktopIntroScale),
    } as CSSProperties)
    : undefined;

  return (
    <main className={shellClassName} style={shellStyle}>
      <div className="backdrop" />

      {isDesktopIntroPreload || isDesktopIntroActive ? (
        <div className="desktopIntroOverlay" aria-hidden="true">
          {isDesktopIntroLogoReady ? (
            <Image
              src={DESKTOP_INTRO_LOGO_SRC}
              alt=""
              width={306}
              height={93}
              priority
              unoptimized
              className="desktopIntroLogo"
            />
          ) : (
            <div className="playerBootLoader desktopIntroLoader" role="status" aria-live="polite" aria-label="Loading logo animation">
              <div className="playerBootBars" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
              <p>Loading...</p>
            </div>
          )}
        </div>
      ) : null}

      <header className="topbar">
        <div className="brandLockup">
          <Link href="/" aria-label="Yeh That Rocks home" ref={brandLogoTargetRef} onClick={handleBrandLogoClick}>
            <Image
              src="/assets/images/yeh_main_logo.png?v=20260424-4"
              alt="Yeh That Rocks"
              width={306}
              height={93}
              priority
              unoptimized
              className="brandLogo"
            />
          </Link>
          <h1 className="brandTagline">The world&apos;s loudest website</h1>
        </div>

        <div className="headerBar">
          <nav className="mainNav" aria-label="Primary">
            {visibleNavItems.map((item) => {
              const isActive = isRouteActive(item.href, pathname);
              const navHref = getNavHref(item.href);
              return (
                <Link
                  key={item.href}
                  href={navHref}
                  prefetch={false}
                  className={isActive ? "navLink navLinkActive" : "navLink"}
                  onClick={(e) => {
                    if (!isAuthenticated && protectedNavHrefs.has(item.href)) {
                      e.preventDefault();
                      openAuthModal();
                      return;
                    }
                    if (item.href === "/categories" || item.href === "/artists") {
                      requestOverlayOpen(navHref, "video");
                    }
                  }}
                >
                  {item.href === "/categories" ? (
                    <>
                      <span className="navCategoryGlyph" aria-hidden="true">
                        ☣
                      </span>
                      <span>{item.label}</span>
                    </>
                  ) : item.href === "/artists" ? (
                    <>
                      <span className="navArtistsGlyph" aria-hidden="true">
                        🎸︎
                      </span>
                      <span>{item.label}</span>
                    </>
                  ) : item.href === "/top100" ? (
                    <>
                      <span className="navTop100Glyph" aria-hidden="true">
                        🏆︎
                      </span>
                      <span>{item.label}</span>
                    </>
                  ) : item.href === "/favourites" ? (
                    <>
                      <span className="navFavouritesGlyph" aria-hidden="true">
                        ❤️
                      </span>
                      <span>{item.label}</span>
                    </>
                  ) : item.href === "/playlists" ? (
                    <>
                      <span className="navPlaylistsGlyph" aria-hidden="true">
                        ♬
                      </span>
                      <span>{item.label}</span>
                    </>
                  ) : item.href === "/history" ? (
                    <>
                      <span className="navHistoryGlyph" aria-hidden="true">
                        🕘
                      </span>
                      <span>{item.label}</span>
                    </>
                  ) : item.href === "/account" ? (
                    <>
                      <span className="navAccountGlyph" aria-hidden="true">
                        👤
                      </span>
                      <span>{item.label}</span>
                    </>
                  ) : item.href === "/new" ? (
                    <>
                      <span className="navNewGlyph" aria-hidden="true">
                        ⭐
                      </span>
                      <span>{item.label}</span>
                    </>
                  ) : (
                    item.label
                  )}
                </Link>
              );
            })}
            {!shouldShowOverlayPanel ? (
              <button
                type="button"
                className={isMobileCommunityOpen ? "mobileRailToggle navLink navLinkActive" : "mobileRailToggle navLink"}
                onClick={() => setIsMobileCommunityOpen((current) => !current)}
                aria-expanded={isMobileCommunityOpen}
                aria-controls="mobile-community-rail"
              >
                <span className="navCommunityGlyph" aria-hidden="true">💬</span>
                <span>Community</span>
              </button>
            ) : null}
          </nav>

          <div className="searchWrap">
            <div className="searchBar">
              <div className="searchCombobox" ref={searchComboboxRef} role="combobox" aria-expanded={showSuggestions} aria-haspopup="listbox">
                <input
                  id="search"
                  type="search"
                  placeholder="Search rock, metal, artists..."
                  required
                  autoComplete="off"
                  value={searchValue}
                  onChange={handleSearchInput}
                  onKeyDown={handleSearchKeyDown}
                  onFocus={() => {
                    if (searchValue.trim().length >= 1 && suggestions.length > 0) {
                      setShowSuggestions(true);
                    }
                  }}
                  aria-expanded={showSuggestions}
                  aria-autocomplete="list"
                  aria-controls="search-suggestions"
                  aria-activedescendant={activeSuggestionIdx >= 0 ? `search-suggestion-${activeSuggestionIdx}` : undefined}
                />
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="searchSuggestions" id="search-suggestions" role="listbox">
                    {suggestions.map((s, i) => (
                      <li key={`${s.type}-${s.label}`} role="option" aria-selected={i === activeSuggestionIdx}>
                        <button
                          type="button"
                          id={`search-suggestion-${i}`}
                          className="searchSuggestionItem"
                          aria-selected={i === activeSuggestionIdx}
                          onPointerDown={(e) => {
                            e.preventDefault(); // prevent input blur before click fires
                            handleSuggestionClick(s);
                          }}
                        >
                          <span className="searchSuggestionType">{s.type}</span>
                          <span className="searchSuggestionLabel">{s.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (searchValue.trim()) {
                    router.push(`/search?q=${encodeURIComponent(searchValue.trim())}&v=${encodeURIComponent(currentVideo.id)}`);
                    setShowSuggestions(false);
                    setSearchValue("");
                  }
                }}
              >
                Search
              </button>
              <label className="searchLabel srOnly" htmlFor="search">
                Search artists, tracks, and chaos
              </label>
            </div>
          </div>
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
        <div className="authStatusModalOverlay">
          <section
            className="authStatusModalDialog"
            role="dialog"
            aria-modal="true"
            aria-live="polite"
            aria-labelledby="auth-unavailable-title"
            aria-describedby="auth-unavailable-message"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="authStatusModalCopy">
              <strong id="auth-unavailable-title">Auth server unavailable</strong>
              <p id="auth-unavailable-message">{authStatusMessage}</p>
            </div>
            <div className="authStatusModalActions">
              <button
                type="button"
                aria-label="Retry auth now"
                title="Retry auth now"
                onClick={() => void retryAuthStateCheck()}
                disabled={isRetryingAuthStatus}
              >
                {isRetryingAuthStatus ? "Trying again..." : "Try again"}
              </button>
            </div>
          </section>
        </div>
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
            activeLetter={activeArtistLetter}
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
                      onClick={() => setChatMode("global")}
                    >
                      Chat
                    </button>
                    <button
                      type="button"
                      className={chatMode === "magazine" ? "activeTab" : undefined}
                      onClick={() => {
                        setChatMode("magazine");
                        favouritesBlindInnerRef.current?.scrollTo({ top: 0, behavior: "auto" });
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
                        if (!isAuthenticated) {
                          openAuthModal();
                          return;
                        }

                        setChatMode("online");
                      }}
                    >
                      Who&apos;s Online
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
                  latestMagazineTracks.length === 0 ? (
                    <p className="chatStatus">No magazine articles are available yet.</p>
                  ) : (
                    <>
                      <div className="magazineRailHeader">
                        <strong>Latest Articles</strong>
                      </div>
                      {latestMagazineTracks.map((track) => (
                        <article
                          key={track.slug}
                          className="magazineRailCard magazineRailCardClickable"
                          onClick={() => router.push(`/magazine/${encodeURIComponent(track.slug)}`)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              router.push(`/magazine/${encodeURIComponent(track.slug)}`);
                            }
                          }}
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
                          <div className="magazineRailBody">
                            <div className="messageMeta">
                              <strong>{track.artist}</strong>
                              <span>{track.genre}</span>
                            </div>
                            <p>{track.title}</p>
                          </div>
                        </article>
                      ))}
                    </>
                  )
                ) : chatMode === "online" ? (
                  !isChatLoading && onlineUsers.length === 0 ? (
                    <p className="chatStatus">No users currently online.</p>
                  ) : (
                    onlineUsers.map((user) => (
                      <article
                        key={user.id}
                        className="chatMessage chatMessageClickable"
                        onClick={() => router.push(`/u/${encodeURIComponent(user.name)}`)}
                      >
                        {user.avatarUrl ? (
                          <Image src={user.avatarUrl} alt="" width={88} height={88} className="chatAvatar" loading="lazy" sizes="44px" />
                        ) : (
                          <div className="avatar">{user.name.slice(0, 1)}</div>
                        )}
                        <div>
                          <div className="messageMeta">
                            <strong>{user.name}</strong>
                            <span className="chatOnlineBadge" title="Online now">● Online</span>
                            <span>{user.lastSeen ? formatChatTimestamp(user.lastSeen) : "Now"}</span>
                          </div>
                          <p>Online now</p>
                        </div>
                      </article>
                    ))
                  )
                ) : (
                  chatMessages.map((message) => {
                    const isUserOnline = onlineUsers.some((u) => u.name === message.user.name);
                    const sharedVideo = parseSharedVideoMessage(message.content);
                    return (
                      <article
                        key={message.id}
                        className="chatMessage chatMessageClickable"
                        onClick={() => router.push(`/u/${encodeURIComponent(message.user.name)}`)}
                      >
                        {message.user.avatarUrl ? (
                          <Image src={message.user.avatarUrl} alt="" width={88} height={88} className="chatAvatar" loading="lazy" sizes="44px" />
                        ) : (
                          <div className="avatar">{message.user.name.slice(0, 1)}</div>
                        )}
                        <div>
                          <div className="messageMeta">
                            <strong>{message.user.name}</strong>
                            {isUserOnline ? <span className="chatOnlineBadge" title="Online now">● Online</span> : null}
                            <span>{formatChatTimestamp(message.createdAt)}</span>
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
                  onAuthRequired={openAuthModal}
                  isDockedDesktop={shouldDockDesktopPlayer}
                  suppressAuthWall={!isAuthenticated && isMagazineOverlayRoute}
                  seenVideoIds={seenVideoIdsRef.current}
                  onHideVideo={handleHideFromWatchNext}
                  onAddVideoToPlaylist={handleAddToPlaylistFromWatchNext}
                  onDockHideRequest={() => setIsDockHidden(true)}
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
                          <div className="favouritesBlindBar categoriesHeaderBar">
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
                          </div>

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
                          <div className="favouritesBlindBar">
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
                          </div>

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
            {isLyricsOverlayOpen ? (
              <section
                className="rightRailLyricsOverlay"
                role="dialog"
                aria-modal="false"
                aria-label="Lyrics"
              >
                <div className="rightRailLyricsOverlayHeader">
                  <strong>Lyrics</strong>
                  <button
                    type="button"
                    className="rightRailLyricsOverlayClose"
                    aria-label="Close lyrics overlay"
                    onClick={() => setIsLyricsOverlayOpen(false)}
                  >
                    ×
                  </button>
                </div>

                <div className="rightRailLyricsOverlayBody">
                  {isLyricsOverlayLoading ? (
                    <p className="rightRailStatus">Loading lyrics...</p>
                  ) : lyricsOverlayError ? (
                    <p className="rightRailStatus rightRailStatusError">{lyricsOverlayError}</p>
                  ) : lyricsOverlayData?.available && lyricsOverlayData.lyrics ? (
                    <>
                      {lyricsOverlayData.artistName || lyricsOverlayData.trackName ? (
                        <p className="rightRailLyricsOverlayMeta">
                          {lyricsOverlayData.artistName ? lyricsOverlayData.artistName : "Unknown artist"}
                          {lyricsOverlayData.trackName ? ` - ${lyricsOverlayData.trackName}` : ""}
                        </p>
                      ) : null}
                      <pre className="rightRailLyricsOverlayText">{lyricsOverlayData.lyrics}</pre>
                    </>
                  ) : (
                    <p className="rightRailStatus">{lyricsOverlayData?.message ?? "No lyrics available for this track."}</p>
                  )}
                </div>
              </section>
            ) : null}
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
            <div className="rightRailWatchNextHeader">
              <button
                type="button"
                className={`newPageSeenToggle watchNextSeenToggle${watchNextHideSeen ? " newPageSeenToggleActive" : ""}`}
                onClick={() => setWatchNextHideSeen((value) => !value)}
                aria-pressed={watchNextHideSeen}
              >
                {watchNextHideSeen ? "Showing unseen only" : "Show unseen only"}
              </button>
            </div>
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

              {watchNextLoadFailed && visibleWatchNextVideos.length === 0 ? (
                <div className="rightRailStatus rightRailStatusError" role="status" aria-live="polite">
                  <p>Watch Next is taking too long to load. Retrying now.</p>
                  <button
                    type="button"
                    className="newPageSeenToggle"
                    onClick={() => {
                      void loadMoreRelatedVideos();
                    }}
                  >
                    Retry now
                  </button>
                </div>
              ) : null}

              {shouldShowWatchNextRailLoader ? (
                <div className="relatedLoadingState" role="status" aria-live="polite" aria-busy="true">
                  <div className="playerBootBars" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <span>Loading videos...</span>
                </div>
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

                  {shouldShowWatchNextUnseenEmptyState ? (
                    <p className="rightRailStatus">No unseen videos in Watch Next right now.</p>
                  ) : null}

                  {shouldShowWatchNextEmptyState ? (
                    <p className="rightRailStatus">No Watch Next videos available right now.</p>
                  ) : null}

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
                        <div className="thumbGlow">
                          <YouTubeThumbnailImage
                            videoId={track.id}
                            alt={track.title}
                            className="relatedThumb"
                            loading={index < 3 ? "eager" : "lazy"}
                            fetchPriority={index < 2 ? "high" : "auto"}
                            reportReason="thumbnail-load-error:watch-next-queue"
                            hideClosestSelector=".relatedCardSlot"
                          />
                        </div>
                        <div>
                          <div className="relatedCardSourceBadges">
                            {track.isFavouriteSource ? <span className="relatedSourceBadge relatedSourceBadgeFavourite">Favourite</span> : null}
                            {track.isTop100Source ? <span className="relatedSourceBadge relatedSourceBadgeTop100">Top100</span> : null}
                            {track.isNewSource ? <span className="relatedSourceBadge relatedSourceBadgeNew">New</span> : null}
                          </div>
                          <h3>{track.title}</h3>
                          <p>
                            <ArtistWikiLink artistName={track.channelTitle} videoId={track.id} className="artistInlineLink">
                              {track.channelTitle}
                            </ArtistWikiLink>
                          </p>
                        </div>
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
                <div
                  className="rightRailDeleteConfirmBackdrop"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Delete playlist confirmation"
                  onClick={() => {
                    if (!isDeletingActivePlaylist) {
                      setShowDeleteActivePlaylistConfirm(false);
                    }
                  }}
                >
                  <div
                    className="rightRailDeleteConfirmModal"
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    <div className="rightRailDeleteConfirmHeader">
                      <span className="rightRailDeleteConfirmIcon" aria-hidden="true">⚠</span>
                      <h3>Delete Playlist?</h3>
                    </div>
                    <p className="rightRailDeleteConfirmPrompt">This action is permanent and cannot be undone.</p>
                    <p className="rightRailDeleteConfirmTarget">
                      {playlistRailData?.name ?? activePlaylistSummary?.name ?? "Current playlist"}
                    </p>
                    <div className="rightRailDeleteConfirmActions">
                      <button
                        type="button"
                        onClick={() => {
                          setShowDeleteActivePlaylistConfirm(false);
                        }}
                        disabled={isDeletingActivePlaylist}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowDeleteActivePlaylistConfirm(false);
                          void handleDeleteActivePlaylist();
                        }}
                        disabled={isDeletingActivePlaylist}
                      >
                        {isDeletingActivePlaylist ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {confirmDeleteRailPlaylist ? (
                <div
                  className="rightRailDeleteConfirmBackdrop"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Delete playlist confirmation"
                  onClick={() => {
                    if (!playlistBeingDeletedId) {
                      setConfirmDeleteRailPlaylist(null);
                    }
                  }}
                >
                  <div
                    className="rightRailDeleteConfirmModal"
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    <div className="rightRailDeleteConfirmHeader">
                      <span className="rightRailDeleteConfirmIcon" aria-hidden="true">⚠</span>
                      <h3>Delete Playlist?</h3>
                    </div>
                    <p className="rightRailDeleteConfirmPrompt">This action is permanent and cannot be undone.</p>
                    <p className="rightRailDeleteConfirmTarget">{confirmDeleteRailPlaylist.name}</p>
                    <div className="rightRailDeleteConfirmActions">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteRailPlaylist(null);
                        }}
                        disabled={Boolean(playlistBeingDeletedId)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const playlistId = confirmDeleteRailPlaylist.id;
                          setConfirmDeleteRailPlaylist(null);
                          void handleDeletePlaylistFromRail(playlistId);
                        }}
                        disabled={Boolean(playlistBeingDeletedId)}
                      >
                        {playlistBeingDeletedId ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="relatedStackPlaylistBody" ref={playlistStackBodyRef}>

              {!activePlaylistId ? (
                isPlaylistSummaryLoading ? (
                  <div className="relatedLoadingState" role="status" aria-live="polite" aria-busy="true">
                    <span className="playerBootBars" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                    </span>
                    <span>Loading playlists...</span>
                  </div>
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
                        <div className="thumbGlow">
                          {hasLeadThumbnail ? (
                            <YouTubeThumbnailImage
                              videoId={playlist.leadVideoId}
                              alt=""
                              loading="lazy"
                              className="relatedThumb"
                              reportReason="thumbnail-load-error:playlist-summary"
                              hideClosestSelector=".rightRailPlaylistCard"
                            />
                          ) : (
                            <div className="playlistRailThumbPlaceholder" aria-hidden="true">♬</div>
                          )}
                        </div>
                        <div>
                          <h3>{playlist.name}</h3>
                          <p>{playlist.itemCount} {playlist.itemCount === 1 ? "track" : "tracks"}</p>
                        </div>
                      </Link>
                    );
                  })
                ) : (
                  <div className="rightRailEmptyState">
                    <p className="rightRailStatus">No playlists yet.</p>
                    <button
                      type="button"
                      className="rightRailCreatePlaylistButton"
                      onClick={() => {
                        void handleCreatePlaylistFromRail();
                      }}
                      disabled={isCreatingRailPlaylist}
                    >
                      {isCreatingRailPlaylist ? "+ Creating..." : "+ Create playlist"}
                    </button>
                  </div>
                )
              ) : isPlaylistRailLoading || isCreatingActivePlaylist ? (
                <div className="relatedLoadingState" role="status" aria-live="polite" aria-busy="true">
                  <span className="playerBootBars" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </span>
                  <span>{isCreatingActivePlaylist ? "Creating playlist..." : "Loading playlist tracks..."}</span>
                </div>
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
                  const placeholder = (key: string) => (
                    <div
                      key={key}
                      className="playlistRailDropPlaceholder"
                      aria-hidden="true"
                      onDragOver={(event) => handlePlaylistTrackDragOver(event, index)}
                      onDrop={(event) => handlePlaylistTrackDrop(event, index)}
                    />
                  );
                  return [
                    ...(showPlaceholderAbove ? [placeholder(`rph-above-${index}`)] : []),
                    <div
                      key={track.playlistItemId ?? `${track.id}-${index}`}
                      data-playlist-index={index}
                      className={[
                        "playlistRailTrackRow",
                        isRecentlyAddedTrack ? "playlistRailTrackRowAdded" : "",
                        isTrackRemoving ? "relatedCardSlotExiting" : "",
                        isDraggingThis ? "playlistRailTrackRowDraggingSource" : "",
                        isDragOver ? "playlistRailTrackRowDragOver" : "",
                      ].filter(Boolean).join(" ")}
                      onDragOver={(event) => handlePlaylistTrackDragOver(event, index)}
                      onDrop={(event) => handlePlaylistTrackDrop(event, index)}
                    >
                      <div className="playlistRailReorderColumn">
                        <button
                          type="button"
                          className="playlistRailReorderChevron"
                          aria-label={`Move ${track.title} up`}
                          title="Move up"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void handleReorderActivePlaylistTrack(index, index - 1);
                          }}
                          disabled={index === 0 || isTrackRemoving || isTrackMutating}
                        >
                          <span className="playlistRailChevronGlyph">{"<"}</span>
                        </button>
                        <button
                          type="button"
                          className="playlistRailReorderChevron"
                          aria-label={`Move ${track.title} down`}
                          title="Move down"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void handleReorderActivePlaylistTrack(index, index + 1);
                          }}
                          disabled={index >= playlistRailData.videos.length - 1 || isTrackRemoving || isTrackMutating}
                        >
                          <span className="playlistRailChevronGlyph">{">"}</span>
                        </button>
                      </div>
                      <div
                        className={[
                          "relatedCardSlot",
                          "playlistRailTrackDraggable",
                          isTrackRemoving ? "relatedCardSlotExiting" : "",
                        ].filter(Boolean).join(" ")}
                        data-video-id={track.id}
                        draggable={!isTrackRemoving && !isTrackMutating}
                        onDragStart={(event) => handlePlaylistTrackDragStart(event, index)}
                        onDragEnd={handlePlaylistTrackDragEnd}
                      >
                      <button
                        type="button"
                        className="relatedCardHideButton"
                        aria-label={`Remove ${track.title} from playlist`}
                        title="Remove from playlist"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void handleRemoveTrackFromActivePlaylist(track, index);
                        }}
                        disabled={isTrackRemoving || isTrackMutating}
                      >
                        ×
                      </button>
                      <Link
                        href={`/?v=${track.id}&pl=${encodeURIComponent(playlistRailData.id)}&pli=${index}`}
                        className={`relatedCard linkedCard rightRailPlaylistTrackCard${isCurrentPlaylistTrack ? " relatedCardActive" : ""}`}
                        prefetch={false}
                        draggable={false}
                      >
                        <div className="thumbGlow">
                          <YouTubeThumbnailImage
                            videoId={track.id}
                            alt={track.title}
                            loading={index < 3 ? "eager" : "lazy"}
                            fetchPriority={index < 2 ? "high" : "auto"}
                            className="relatedThumb"
                            reportReason="thumbnail-load-error:playlist-track"
                            hideClosestSelector=".relatedCardSlot"
                          />
                        </div>
                        <div>
                          <h3>{track.title}</h3>
                          <p>
                            <ArtistWikiLink artistName={track.channelTitle} videoId={track.id} className="artistInlineLink">
                              {track.channelTitle}
                            </ArtistWikiLink>
                          </p>
                        </div>
                      </Link>
                      </div>
                    </div>,
                    ...(showPlaceholderBelow ? [placeholder(`rph-below-${index}`)] : []),
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
  );
}

export function ShellDynamic(props: ShellDynamicProps) {
  return (
    <Suspense>
      <ShellDynamicInner {...props} />
    </Suspense>
  );
}
