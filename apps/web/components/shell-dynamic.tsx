"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, Suspense, useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CSSProperties } from "react";

import { AuthLoginForm } from "@/components/auth-login-form";
import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { ArtistsLetterNav } from "@/components/artists-letter-nav";
import { PlayerExperience } from "@/components/player-experience";
import { useSeenTogglePreference } from "@/components/use-seen-toggle-preference";
import { navItems, type VideoRecord } from "@/lib/catalog";
import { trackPageView, trackVideoView } from "@/lib/analytics-client";
import { parseSharedVideoMessage } from "@/lib/chat-shared-video";

if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
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
        // React dev profiling can sporadically emit invalid ranges; avoid hard-crashing route render.
        if (message.includes("negative time stamp")) {
          return undefined as unknown as ReturnType<Performance["measure"]>;
        }

        throw error;
      }
    }) as Performance["measure"];
  }
}

type ChatMode = "global" | "video" | "online";

type ChatMessage = {
  id: number;
  content: string;
  createdAt: string | null;
  room: string;
  videoId: string | null;
  user: {
    id: number | null;
    name: string;
    avatarUrl: string | null;
  };
};

type OnlineUser = {
  id: number;
  name: string;
  avatarUrl: string | null;
  lastSeen: string | null;
  isOnline?: boolean;
};

type CurrentVideoResolvePayload = {
  currentVideo?: VideoRecord;
  relatedVideos?: VideoRecord[];
  pending?: boolean;
  denied?: { message?: string; reason?: string; videoId?: string };
};

type RightRailMode = "watch-next" | "playlist";

type PlaylistRailVideo = {
  playlistItemId: string;
  id: string;
  title: string;
  channelTitle: string;
  thumbnail?: string | null;
};

type PlaylistRailPayload = {
  id: string;
  name: string;
  videos: PlaylistRailVideo[];
  itemCount?: number;
};

type PlaylistRailSummary = {
  id: string;
  name: string;
  itemCount: number;
  leadVideoId: string;
};

type FlashableChatMode = "global" | "video";

type SharedVideoPreview = {
  id: string;
  title: string;
  channelTitle: string;
};

const REQUEST_VIDEO_REPLAY_EVENT = "ytr:request-video-replay";

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

function buildYouTubeThumbnail(videoId: string) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

function SharedVideoMessageCard({ videoId }: { videoId: string }) {
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

type ShellDynamicProps = {
  initialVideo: VideoRecord;
  initialRelatedVideos: VideoRecord[];
  initialSeenVideoIds?: string[];
  initialHiddenVideoIds?: string[];
  isLoggedIn: boolean;
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
const RELATED_LOAD_BATCH_SIZE = 5;
const RELATED_LOAD_AHEAD_PX = 560;
const RELATED_MAX_VIDEOS = Number.MAX_SAFE_INTEGER;
const RELATED_BACKGROUND_PREFETCH_TARGET = 35;
const RELATED_BACKGROUND_PREFETCH_DELAY_MS = 650;
const WATCH_NEXT_HIDE_ANIMATION_MS = 240;
const WATCH_NEXT_HIDE_SEEN_TOGGLE_KEY = "ytr-toggle-hide-seen-watch-next";
const PREFETCH_FAILURE_BASE_BACKOFF_MS = 1_500;
const PREFETCH_FAILURE_MAX_BACKOFF_MS = 20_000;
const PLAYLISTS_UPDATED_EVENT = "ytr:playlists-updated";
const RIGHT_RAIL_MODE_EVENT = "ytr:right-rail-mode";
const PLAYLIST_RAIL_SYNC_EVENT = "ytr:playlist-rail-sync";
const PLAYLIST_CREATION_PROGRESS_EVENT = "ytr:playlist-creation-progress";
const WATCH_HISTORY_UPDATED_EVENT = "ytr:watch-history-updated";
const OVERLAY_OPEN_REQUEST_EVENT = "ytr:overlay-open-request";
const DOCK_MOVE_DURATION_MS = 520;
const DOCK_CONTROLS_FADE_DURATION_MS = 220;
const DOCK_CONTROLS_FADE_DELAY_MS = Math.max(0, DOCK_MOVE_DURATION_MS - DOCK_CONTROLS_FADE_DURATION_MS);
const FOOTER_REVEAL_DURATION_MS = 240;
const DESKTOP_INTRO_HOLD_MS = 1300;
const DESKTOP_INTRO_MOVE_MS = 760;
const DESKTOP_INTRO_REVEAL_MS = 820;
const DESKTOP_INTRO_MAX_LOGO_WIDTH_PX = 1128;
const DESKTOP_INTRO_VIEWPORT_WIDTH_RATIO = 1.128;
const INTRO_SKIP_ONCE_AFTER_LOGIN_KEY = "ytr:intro-skip-once";

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

function logFlow(event: string, detail?: Record<string, unknown>) {
  if (!FLOW_DEBUG_ENABLED) {
    return;
  }

  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[flow/shell] ${event}${payload}`);
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

const AUTH_PROBE_FAILURE_THRESHOLD = 2;

function ShellDynamicInner({
  initialVideo,
  initialRelatedVideos,
  initialSeenVideoIds = [],
  initialHiddenVideoIds = [],
  isLoggedIn,
  isAdmin,
  children,
}: ShellDynamicProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const requestedVideoId = searchParams.get("v") || null;
  const activePlaylistId = searchParams.get("pl");
  const initialHydratedRelatedVideos = dedupeRelatedRailVideos(dedupeVideoList(initialRelatedVideos), initialVideo.id);

  const [currentVideo, setCurrentVideo] = useState(initialVideo);
  const [relatedVideos, setRelatedVideos] = useState<VideoRecord[]>(initialHydratedRelatedVideos);
  const [displayedRelatedVideos, setDisplayedRelatedVideos] = useState<VideoRecord[]>(initialHydratedRelatedVideos);
  const [relatedTransitionPhase, setRelatedTransitionPhase] = useState<"idle" | "fading-out" | "loading" | "fading-in">("idle");
  const [isLoadingMoreRelated, setIsLoadingMoreRelated] = useState(false);
  const [hasMoreRelated, setHasMoreRelated] = useState(true);
  const seenVideoIdsRef = useRef<Set<string>>(new Set(initialSeenVideoIds));
  const hiddenVideoIdsRef = useRef<Set<string>>(new Set(initialHiddenVideoIds));
  const activeVideoId = requestedVideoId ?? currentVideo.id;
  const [isAuthenticated, setIsAuthenticated] = useState(isLoggedIn);
  const [deniedPlaybackMessage, setDeniedPlaybackMessage] = useState<string | null>(null);
  const [chatMode, setChatMode] = useState<ChatMode>("global");
  const [rightRailMode, setRightRailMode] = useState<RightRailMode>("watch-next");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [playlistRailData, setPlaylistRailData] = useState<PlaylistRailPayload | null>(null);
  const [isPlaylistRailLoading, setIsPlaylistRailLoading] = useState(false);
  const [playlistRailError, setPlaylistRailError] = useState<string | null>(null);
  const [playlistRailSummaries, setPlaylistRailSummaries] = useState<PlaylistRailSummary[]>([]);
  const [isPlaylistSummaryLoading, setIsPlaylistSummaryLoading] = useState(false);
  const [playlistSummaryError, setPlaylistSummaryError] = useState<string | null>(null);
  const [playlistRefreshTick, setPlaylistRefreshTick] = useState(0);
  const [playlistMutationMessage, setPlaylistMutationMessage] = useState<string | null>(null);
  const [playlistMutationTone, setPlaylistMutationTone] = useState<"info" | "success" | "error">("info");
  const [playlistMutationPendingVideoId, setPlaylistMutationPendingVideoId] = useState<string | null>(null);
  const [isCreatingRailPlaylist, setIsCreatingRailPlaylist] = useState(false);
  const [playlistCreationPendingId, setPlaylistCreationPendingId] = useState<string | null>(null);
  const [lastAddedRelatedVideoId, setLastAddedRelatedVideoId] = useState<string | null>(null);
  const [recentlyAddedPlaylistTrack, setRecentlyAddedPlaylistTrack] = useState<{ playlistId: string; trackId: string } | null>(null);
  const [forcedUnavailableSignal, setForcedUnavailableSignal] = useState(0);
  const [forcedUnavailableMessage, setForcedUnavailableMessage] = useState<string | null>(null);
  const [hidingPlaylistTrackKeys, setHidingPlaylistTrackKeys] = useState<string[]>([]);
  const [playlistItemMutationPendingKeys, setPlaylistItemMutationPendingKeys] = useState<string[]>([]);
  const reorderSeqRef = useRef(0);
  const suppressPlaylistRailAutoSwitchRef = useRef(false);
  // Stores the id of a playlist created via the Watch Next rail before the URL params
  // (?pl=) have propagated to the next React render. Without this, rapid successive
  // clicks each see activePlaylistId===null and create separate playlists.
  const pendingCreatedPlaylistIdRef = useRef<string | null>(null);
  const [draggedPlaylistTrackIndex, setDraggedPlaylistTrackIndex] = useState<number | null>(null);
  const [dragOverPlaylistTrackIndex, setDragOverPlaylistTrackIndex] = useState<number | null>(null);
  const [isDeletingActivePlaylist, setIsDeletingActivePlaylist] = useState(false);
  const [showDeleteActivePlaylistConfirm, setShowDeleteActivePlaylistConfirm] = useState(false);
  const [confirmDeleteRailPlaylist, setConfirmDeleteRailPlaylist] = useState<{ id: string; name: string } | null>(null);
  const [playlistBeingDeletedId, setPlaylistBeingDeletedId] = useState<string | null>(null);
  const [hidingRelatedVideoIds, setHidingRelatedVideoIds] = useState<string[]>([]);
  const [hiddenMutationPendingVideoIds, setHiddenMutationPendingVideoIds] = useState<string[]>([]);
  const [watchNextHideSeen, setWatchNextHideSeen] = useSeenTogglePreference({
    key: WATCH_NEXT_HIDE_SEEN_TOGGLE_KEY,
    isAuthenticated,
  });
  const [, setSeenVideoRefreshTick] = useState(0);
  const [clickedRelatedVideoId, setClickedRelatedVideoId] = useState<string | null>(null);
  const [isChatSubmitting, setIsChatSubmitting] = useState(false);
  const [flashingChatTabs, setFlashingChatTabs] = useState<Record<FlashableChatMode, boolean>>({
    global: false,
    video: false,
  });
  const [isResolvingInitialVideo, setIsResolvingInitialVideo] = useState(
    !requestedVideoId,
  );
  const [isResolvingRequestedVideo, setIsResolvingRequestedVideo] = useState(
    Boolean(requestedVideoId && requestedVideoId !== initialVideo.id),
  );
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isMobileCommunityOpen, setIsMobileCommunityOpen] = useState(false);
  const [isDesktopIntroPreload, setIsDesktopIntroPreload] = useState(true);
  const [desktopIntroPhase, setDesktopIntroPhase] = useState<"disabled" | "hold" | "moving" | "revealing" | "done">("disabled");
  const [hasClientMounted, setHasClientMounted] = useState(false);
  const [hasBootstrappedWatchNext, setHasBootstrappedWatchNext] = useState(false);
  const [desktopIntroDeltaX, setDesktopIntroDeltaX] = useState(0);
  const [desktopIntroDeltaY, setDesktopIntroDeltaY] = useState(0);
  const [desktopIntroScale, setDesktopIntroScale] = useState(1);
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);
  const authProbeFailureCountRef = useRef(0);
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
  const pendingRelatedVideosRef = useRef<VideoRecord[] | null>(null);
  const relatedTransitionTimeoutRef = useRef<number | null>(null);
  const relatedClickFlashTimeoutRef = useRef<number | null>(null);
  const relatedHideTimeoutsRef = useRef<Map<string, number>>(new Map());
  const playlistItemHideTimeoutsRef = useRef<Map<string, number>>(new Map());
  const relatedStackRef = useRef<HTMLDivElement | null>(null);
  const relatedLoadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const relatedLoadInFlightRef = useRef(false);
  const relatedFetchOffsetRef = useRef<number | null>(null);
  const relatedScrollRafRef = useRef<number | null>(null);
  const relatedVideosRef = useRef<VideoRecord[]>([]);
  const transitionFromVideoIdRef = useRef<string | null>(null);
  const watchNextRailRef = useRef<HTMLElement | null>(null);
  const playerChromeRef = useRef<HTMLDivElement | null>(null);
  const brandLogoTargetRef = useRef<HTMLAnchorElement | null>(null);
  const prevFadeVideoIdRef = useRef<string | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const favouritesBlindInnerRef = useRef<HTMLDivElement | null>(null);
  const previousPathnameRef = useRef<string | null>(null);
  const previousActivePlaylistIdRef = useRef<string | null>(activePlaylistId);
  const playlistRailLoadRequestIdRef = useRef(0);
  const playlistRailMutationVersionRef = useRef(0);
  const flashTimeoutRef = useRef<Record<FlashableChatMode, number | null>>({
    global: null,
    video: null,
  });
  const chatModeRef = useRef<ChatMode>(chatMode);
  const recentlyAddedPlaylistTrackTimeoutRef = useRef<number | null>(null);

  // Search autocomplete
  type SearchSuggestion = { type: "artist" | "track" | "genre"; label: string; url: string };
  const [searchValue, setSearchValue] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(-1);
  const [artistsPanelDockOffset, setArtistsPanelDockOffset] = useState(0);
  const [playerDockScaleX, setPlayerDockScaleX] = useState(1);
  const [playerDockScaleY, setPlayerDockScaleY] = useState(1);
  const [playerDockHeightPx, setPlayerDockHeightPx] = useState(0);
  const [isOverlayClosing, setIsOverlayClosing] = useState(false);
  const [isFooterRevealActive, setIsFooterRevealActive] = useState(false);
  const [isDockTransitioning, setIsDockTransitioning] = useState(false);
  const [isDockHidden, setIsDockHidden] = useState(false);
  const [pendingOverlayOpenKind, setPendingOverlayOpenKind] = useState<"wiki" | "video" | null>(null);
  const [startupSelectionRefreshTick, setStartupSelectionRefreshTick] = useState(0);
  const overlayCloseTimeoutRef = useRef<number | null>(null);
  const overlayOpenTimeoutRef = useRef<number | null>(null);
  const footerRevealTimeoutRef = useRef<number | null>(null);
  const shouldRunFooterRevealRef = useRef(false);
  const dockTransitionTimeoutRef = useRef<number | null>(null);
  const desktopIntroHoldTimeoutRef = useRef<number | null>(null);
  const desktopIntroMoveTimeoutRef = useRef<number | null>(null);
  const desktopIntroRevealTimeoutRef = useRef<number | null>(null);
  const desktopIntroMeasureRafRef = useRef<number | null>(null);
  const shouldReplayDesktopIntroOnHomeRef = useRef(false);
  const desktopIntroPhaseRef = useRef<"disabled" | "hold" | "moving" | "revealing" | "done">("disabled");
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);
  const latestSuggestQueryRef = useRef("");
  const searchComboboxRef = useRef<HTMLDivElement | null>(null);
  // Refs to reliably access current state in event handlers
  const suggestionsRef = useRef<SearchSuggestion[]>([]);
  const showSuggestionsRef = useRef(false);
  const activeSuggestionIdxRef = useRef(-1);

  const isCategoriesRoute = pathname === "/categories" || pathname.startsWith("/categories/");
  const isArtistsRoute = pathname === "/artists" || pathname.startsWith("/artist/") || pathname.startsWith("/artists/");
  const previousPathname = previousPathnameRef.current;
  const previousWasCategoriesRoute = previousPathname === "/categories" || previousPathname?.startsWith("/categories/") === true;
  const previousWasArtistsRoute = previousPathname === "/artists"
    || previousPathname?.startsWith("/artist/") === true
    || previousPathname?.startsWith("/artists/") === true;
  const isOverlayRoute = pathname !== "/";
  const shouldShowOverlayPanel = isOverlayRoute || pendingOverlayOpenKind !== null;
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
  const shouldRunChat = isAuthenticated && !shouldShowOverlayPanel;
  const shouldDisableRelatedRailTransition = pathname === "/new";
  const isWaitingForClientHydration = !hasClientMounted;
  const isDesktopIntroActive =
    desktopIntroPhase === "hold"
    || desktopIntroPhase === "moving"
    || desktopIntroPhase === "revealing";
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
  const shouldDockDesktopPlayer = shouldShowOverlayPanel;
  const shouldDockUnderArtistsAlphabet = shouldDockDesktopPlayer && isArtistsIndexRoute;
  const playerChromeClassName = [
    "playerChrome",
    shouldDockDesktopPlayer ? "playerChromeDockedDesktop" : "",
    shouldDockUnderArtistsAlphabet ? "playerChromeDockedArtists" : "",
    shouldDockDesktopPlayer && isDockTransitioning ? "playerChromeDockTransitioning" : "",
    isOverlayClosing ? "playerChromeUndocking" : "",
    !shouldShowOverlayPanel && isFooterRevealActive ? "playerChromeFooterReveal" : "",
    shouldDockDesktopPlayer && isDockHidden ? "playerChromeDockedHidden" : "",
  ].filter(Boolean).join(" ");
  const playerChromeStyle = shouldDockDesktopPlayer
    ? ({
      "--player-dock-artists-offset": `${artistsPanelDockOffset}px`,
      "--player-dock-scale-x": String(playerDockScaleX),
      "--player-dock-scale-y": String(playerDockScaleY),
      "--player-dock-height": `${playerDockHeightPx}px`,
    } as CSSProperties)
    : undefined;
  const isMobileCommunityCollapsed = isMobileViewport && !isMobileCommunityOpen;

  useEffect(() => {
    setHasClientMounted(true);
  }, []);

  useEffect(() => {
    previousPathnameRef.current = pathname;
  }, [pathname]);

  // Analytics: fire page_view once on shell mount
  useEffect(() => {
    void trackPageView();
  }, []);

  // Analytics: fire video_view each time the active video changes
  const analyticsLastVideoIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeVideoId && activeVideoId !== analyticsLastVideoIdRef.current) {
      analyticsLastVideoIdRef.current = activeVideoId;
      void trackVideoView(activeVideoId);
    }
  }, [activeVideoId]);

  useEffect(() => {
    desktopIntroPhaseRef.current = desktopIntroPhase;
  }, [desktopIntroPhase]);

  const clearDesktopIntroTimers = useCallback(() => {
    if (desktopIntroHoldTimeoutRef.current !== null) {
      window.clearTimeout(desktopIntroHoldTimeoutRef.current);
      desktopIntroHoldTimeoutRef.current = null;
    }

    if (desktopIntroMoveTimeoutRef.current !== null) {
      window.clearTimeout(desktopIntroMoveTimeoutRef.current);
      desktopIntroMoveTimeoutRef.current = null;
    }

    if (desktopIntroRevealTimeoutRef.current !== null) {
      window.clearTimeout(desktopIntroRevealTimeoutRef.current);
      desktopIntroRevealTimeoutRef.current = null;
    }

    if (desktopIntroMeasureRafRef.current !== null) {
      window.cancelAnimationFrame(desktopIntroMeasureRafRef.current);
      desktopIntroMeasureRafRef.current = null;
    }
  }, []);

  const syncDesktopIntroTarget = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const target = brandLogoTargetRef.current;
    if (!target) {
      return;
    }

    const logoImage = target.querySelector("img.brandLogo");
    const rect = (logoImage ?? target).getBoundingClientRect();
    const viewportCenterX = window.innerWidth / 2;
    const viewportCenterY = window.innerHeight / 2;
    const targetCenterX = rect.left + rect.width / 2;
    const targetCenterY = rect.top + rect.height / 2;
    const introStartWidth = Math.min(window.innerWidth * DESKTOP_INTRO_VIEWPORT_WIDTH_RATIO, DESKTOP_INTRO_MAX_LOGO_WIDTH_PX);
    const targetScale = Math.max(0.3, Math.min(1.2, rect.width / introStartWidth));

    setDesktopIntroDeltaX(targetCenterX - viewportCenterX);
    setDesktopIntroDeltaY(targetCenterY - viewportCenterY);
    setDesktopIntroScale(targetScale);
  }, []);

  const startDesktopIntroSequence = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const isDesktop = window.matchMedia("(min-width: 1181px)").matches;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!isDesktop || prefersReducedMotion) {
      setDesktopIntroPhase("disabled");
      setIsDesktopIntroPreload(false);
      return;
    }

    clearDesktopIntroTimers();
    setDesktopIntroDeltaX(0);
    setDesktopIntroDeltaY(0);
    setDesktopIntroScale(1);
    setDesktopIntroPhase("hold");
    setIsDesktopIntroPreload(false);

    desktopIntroMeasureRafRef.current = window.requestAnimationFrame(() => {
      syncDesktopIntroTarget();
      desktopIntroMeasureRafRef.current = null;
    });

    desktopIntroHoldTimeoutRef.current = window.setTimeout(() => {
      syncDesktopIntroTarget();
      setDesktopIntroPhase("moving");

      desktopIntroMoveTimeoutRef.current = window.setTimeout(() => {
        setDesktopIntroPhase("revealing");
        desktopIntroMoveTimeoutRef.current = null;

        desktopIntroRevealTimeoutRef.current = window.setTimeout(() => {
          setDesktopIntroPhase("done");
          desktopIntroRevealTimeoutRef.current = null;
        }, DESKTOP_INTRO_REVEAL_MS);
      }, DESKTOP_INTRO_MOVE_MS);
    }, DESKTOP_INTRO_HOLD_MS);
  }, [clearDesktopIntroTimers, syncDesktopIntroTarget]);

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
      startDesktopIntroSequence();
    }
  }, [pathname, requestedVideoId, startDesktopIntroSequence]);
  const isLeftRailSuppressed = shouldShowOverlayPanel || isMobileCommunityCollapsed;
  const artistLetterParam = searchParams.get("letter");
  const activeArtistLetter =
    artistLetterParam && /^[A-Za-z]$/.test(artistLetterParam)
      ? artistLetterParam.toUpperCase()
      : "A";
  const resumeParam = searchParams.get("resume") ?? undefined;
  const overlayRouteKey = (() => {
    if (disableOverlayDropAnimation) {
      if (pathname === "/playlists" || pathname.startsWith("/playlists/")) {
        return "playlists-overlay";
      }

      if (pathname === "/categories" || pathname.startsWith("/categories/")) {
        return "categories-overlay";
      }
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
    if (!targetVideoId) {
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
    if (!isAuthenticated && rightRailMode === "playlist") {
      setRightRailMode("watch-next");
    }
  }, [isAuthenticated, rightRailMode]);

  useEffect(() => {
    if (isAuthenticated && activePlaylistId && rightRailMode !== "playlist") {
      if (suppressPlaylistRailAutoSwitchRef.current) {
        suppressPlaylistRailAutoSwitchRef.current = false;
        return;
      }
      setRightRailMode("playlist");
    }
  }, [activePlaylistId, isAuthenticated, rightRailMode]);

  useEffect(() => {
    if (pathname !== "/" || activePlaylistId || rightRailMode === "watch-next") {
      return;
    }

    // Only force-reset when returning from an overlay route to home.
    if (!previousPathname || previousPathname === "/") {
      return;
    }

    setRightRailMode("watch-next");
  }, [activePlaylistId, pathname, previousPathname, rightRailMode]);

  useEffect(() => {
    const previousActivePlaylistId = previousActivePlaylistIdRef.current;

    if (previousActivePlaylistId && !activePlaylistId && rightRailMode === "playlist") {
      setRightRailMode("watch-next");
    }

    previousActivePlaylistIdRef.current = activePlaylistId;

    // Once the URL param has propagated, clear the pending ref so subsequent
    // navigation away and back doesn't skip playlist creation unexpectedly.
    if (activePlaylistId && pendingCreatedPlaylistIdRef.current === activePlaylistId) {
      pendingCreatedPlaylistIdRef.current = null;
    }
  }, [activePlaylistId, rightRailMode]);

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
    if (shouldShowOverlayPanel) {
      setIsMobileCommunityOpen(false);
      return;
    }

    setIsOverlayClosing(false);

    if (!shouldRunFooterRevealRef.current) {
      setIsFooterRevealActive(false);
      return;
    }

    shouldRunFooterRevealRef.current = false;
    setIsFooterRevealActive(true);

    if (typeof window !== "undefined") {
      if (footerRevealTimeoutRef.current !== null) {
        window.clearTimeout(footerRevealTimeoutRef.current);
      }

      footerRevealTimeoutRef.current = window.setTimeout(() => {
        setIsFooterRevealActive(false);
        footerRevealTimeoutRef.current = null;
      }, FOOTER_REVEAL_DURATION_MS);
    }
  }, [shouldShowOverlayPanel]);

  useEffect(() => {
    if (pathname !== "/" && pendingOverlayOpenKind !== null) {
      setPendingOverlayOpenKind(null);
    }
  }, [pathname, pendingOverlayOpenKind]);

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
      }, 4500);
    };

    window.addEventListener(OVERLAY_OPEN_REQUEST_EVENT, handleOverlayOpenRequest);
    return () => {
      window.removeEventListener(OVERLAY_OPEN_REQUEST_EVENT, handleOverlayOpenRequest);
      if (overlayOpenTimeoutRef.current !== null) {
        window.clearTimeout(overlayOpenTimeoutRef.current);
        overlayOpenTimeoutRef.current = null;
      }
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

      if (!isOverlayRoute) {
        router.push(nextHref);
        return;
      }

      if (overlayCloseTimeoutRef.current !== null) {
        window.clearTimeout(overlayCloseTimeoutRef.current);
        overlayCloseTimeoutRef.current = null;
      }

      setIsOverlayClosing(true);
      shouldRunFooterRevealRef.current = true;
      overlayCloseTimeoutRef.current = window.setTimeout(() => {
        overlayCloseTimeoutRef.current = null;
        router.push(nextHref);
      }, DOCK_MOVE_DURATION_MS);
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

      setIsFooterRevealActive(false);
      shouldRunFooterRevealRef.current = false;
    };
  }, [currentVideo.id, isOverlayRoute, router]);

  useEffect(() => {
    if (requestedVideoId) {
      setIsDockHidden(false);
    }
  }, [requestedVideoId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (sessionStorage.getItem(INTRO_SKIP_ONCE_AFTER_LOGIN_KEY) === "1") {
      sessionStorage.removeItem(INTRO_SKIP_ONCE_AFTER_LOGIN_KEY);
      setDesktopIntroPhase("disabled");
      setIsDesktopIntroPreload(false);
    } else {
      startDesktopIntroSequence();
    }

    const handleResize = () => {
      const phase = desktopIntroPhaseRef.current;
      if (phase === "hold" || phase === "moving") {
        syncDesktopIntroTarget();
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);

      clearDesktopIntroTimers();
    };
  }, [clearDesktopIntroTimers, startDesktopIntroSequence, syncDesktopIntroTarget]);

  useEffect(() => {
    if (pathname !== "/" || !shouldReplayDesktopIntroOnHomeRef.current) {
      return;
    }

    shouldReplayDesktopIntroOnHomeRef.current = false;
    startDesktopIntroSequence();
  }, [pathname, startDesktopIntroSequence]);

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
    authProbeFailureCountRef.current = 0;
  }, [isLoggedIn]);

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
    window.addEventListener("resize", syncPlayerDockScale);
    return () => {
      window.removeEventListener("resize", syncPlayerDockScale);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [shouldDockDesktopPlayer, shouldDockUnderArtistsAlphabet, pathname]);

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
        const response = await fetch(`/api/current-video?v=${encodeURIComponent(requestedVideoId)}`);
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

  useEffect(() => {
    const handlePlaylistsUpdated = () => {
      setPlaylistRefreshTick((current) => current + 1);
    };

    const handlePlaylistRailSync = (event: Event) => {
      const detail = (event as CustomEvent<{ playlist?: PlaylistRailPayload; trackId?: string }>).detail;
      const playlist = detail?.playlist;

      if (!playlist?.id || !Array.isArray(playlist.videos)) {
        return;
      }

      if (rightRailMode !== "playlist") {
        return;
      }

      if (activePlaylistId && playlist.id !== activePlaylistId) {
        return;
      }

      setPlaylistCreationPendingId((currentPendingId) => (
        currentPendingId === playlist.id ? null : currentPendingId
      ));

      setPlaylistRailData(playlist);
      setPlaylistRailError(null);
      setIsPlaylistRailLoading(false);
    };

    const handlePlaylistCreationProgress = (event: Event) => {
      const detail = (event as CustomEvent<{ playlistId?: string; phase?: "creating" | "done" | "failed" }>).detail;
      const playlistId = detail?.playlistId;

      if (!playlistId) {
        return;
      }

      if (detail?.phase === "creating") {
        setPlaylistCreationPendingId(playlistId);
        return;
      }

      setPlaylistCreationPendingId((currentPendingId) => (
        currentPendingId === playlistId ? null : currentPendingId
      ));
    };

    const handleRightRailMode = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: RightRailMode; playlistId?: string; trackId?: string }>).detail;
      const mode = detail?.mode;
      if (mode === "watch-next" || mode === "playlist") {
        setRightRailMode(mode);
      }

      if (detail?.playlistId && detail?.trackId) {
        setRecentlyAddedPlaylistTrack({
          playlistId: detail.playlistId,
          trackId: detail.trackId,
        });

        if (recentlyAddedPlaylistTrackTimeoutRef.current !== null) {
          window.clearTimeout(recentlyAddedPlaylistTrackTimeoutRef.current);
        }

        recentlyAddedPlaylistTrackTimeoutRef.current = window.setTimeout(() => {
          setRecentlyAddedPlaylistTrack((current) => (
            current?.playlistId === detail.playlistId && current?.trackId === detail.trackId
              ? null
              : current
          ));
          recentlyAddedPlaylistTrackTimeoutRef.current = null;
        }, 2600);
      }
    };

    window.addEventListener(PLAYLISTS_UPDATED_EVENT, handlePlaylistsUpdated);
    window.addEventListener(PLAYLIST_RAIL_SYNC_EVENT, handlePlaylistRailSync);
    window.addEventListener(RIGHT_RAIL_MODE_EVENT, handleRightRailMode);
    window.addEventListener(PLAYLIST_CREATION_PROGRESS_EVENT, handlePlaylistCreationProgress);

    return () => {
      window.removeEventListener(PLAYLISTS_UPDATED_EVENT, handlePlaylistsUpdated);
      window.removeEventListener(PLAYLIST_RAIL_SYNC_EVENT, handlePlaylistRailSync);
      window.removeEventListener(RIGHT_RAIL_MODE_EVENT, handleRightRailMode);
      window.removeEventListener(PLAYLIST_CREATION_PROGRESS_EVENT, handlePlaylistCreationProgress);

      if (recentlyAddedPlaylistTrackTimeoutRef.current !== null) {
        window.clearTimeout(recentlyAddedPlaylistTrackTimeoutRef.current);
        recentlyAddedPlaylistTrackTimeoutRef.current = null;
      }
    };
  }, [activePlaylistId, rightRailMode]);

  useEffect(() => {
    if (rightRailMode !== "playlist") {
      return;
    }

    if (!activePlaylistId) {
      setPlaylistRailData(null);
      setPlaylistRailError(null);
      setIsPlaylistRailLoading(false);
      return;
    }

    let cancelled = false;
    const requestId = ++playlistRailLoadRequestIdRef.current;
    const mutationVersionAtStart = playlistRailMutationVersionRef.current;

    const loadPlaylistRail = async () => {
      setIsPlaylistRailLoading(true);
      setPlaylistRailError(null);

      try {
        const response = await fetchWithAuthRetry(`/api/playlists/${encodeURIComponent(activePlaylistId)}`, {
          cache: "no-store",
        });

        if (cancelled || requestId !== playlistRailLoadRequestIdRef.current) {
          return;
        }

        if (response.status === 401 || response.status === 403) {
          setIsAuthenticated(false);
          setPlaylistRailData(null);
          setPlaylistRailError("Sign in to view playlist tracks.");
          return;
        }

        if (!response.ok) {
          setPlaylistRailData(null);
          setPlaylistRailError("Could not load playlist tracks.");
          return;
        }

        const payload = (await response.json()) as PlaylistRailPayload;
        if (
          !cancelled
          && requestId === playlistRailLoadRequestIdRef.current
          && mutationVersionAtStart === playlistRailMutationVersionRef.current
        ) {
          setPlaylistRailData(payload);
          setPlaylistCreationPendingId((currentPendingId) => (
            currentPendingId === payload.id ? null : currentPendingId
          ));
        }
      } catch {
        if (!cancelled && requestId === playlistRailLoadRequestIdRef.current) {
          setPlaylistRailData(null);
          setPlaylistRailError("Could not load playlist tracks.");
        }
      } finally {
        if (!cancelled && requestId === playlistRailLoadRequestIdRef.current) {
          setIsPlaylistRailLoading(false);
        }
      }
    };

    void loadPlaylistRail();

    return () => {
      cancelled = true;
    };
  }, [activePlaylistId, fetchWithAuthRetry, pathname, playlistRefreshTick, rightRailMode]);

  useEffect(() => {
    if (rightRailMode !== "playlist") {
      return;
    }

    let cancelled = false;

    const loadPlaylistSummaries = async () => {
      setIsPlaylistSummaryLoading(true);
      setPlaylistSummaryError(null);

      try {
        const response = await fetchWithAuthRetry("/api/playlists");

        if (cancelled) {
          return;
        }

        if (response.status === 401 || response.status === 403) {
          setIsAuthenticated(false);
          setPlaylistRailSummaries([]);
          setPlaylistSummaryError("Sign in to view playlists.");
          return;
        }

        if (!response.ok) {
          setPlaylistRailSummaries([]);
          setPlaylistSummaryError("Could not load playlists.");
          return;
        }

        const payload = (await response.json()) as { playlists?: PlaylistRailSummary[] };
        if (!cancelled) {
          setPlaylistRailSummaries(Array.isArray(payload.playlists) ? payload.playlists : []);
        }
      } catch {
        if (!cancelled) {
          setPlaylistRailSummaries([]);
          setPlaylistSummaryError("Could not load playlists.");
        }
      } finally {
        if (!cancelled) {
          setIsPlaylistSummaryLoading(false);
        }
      }
    };

    void loadPlaylistSummaries();

    return () => {
      cancelled = true;
    };
  }, [activePlaylistId, fetchWithAuthRetry, playlistRefreshTick, rightRailMode]);

  function triggerChatTabFlash(mode: FlashableChatMode) {
    const existingTimeoutId = flashTimeoutRef.current[mode];
    if (existingTimeoutId !== null) {
      window.clearTimeout(existingTimeoutId);
    }

    // Toggle off first so repeated arrivals retrigger the animation.
    setFlashingChatTabs((current) => ({
      ...current,
      [mode]: false,
    }));

    window.requestAnimationFrame(() => {
      setFlashingChatTabs((current) => ({
        ...current,
        [mode]: true,
      }));
    });

    flashTimeoutRef.current[mode] = window.setTimeout(() => {
      setFlashingChatTabs((current) => ({
        ...current,
        [mode]: false,
      }));
      flashTimeoutRef.current[mode] = null;
    }, 900);
  }

  useEffect(() => {
    chatModeRef.current = chatMode;
  }, [chatMode]);

  // Load chat history whenever mode / video / auth changes.
  // For "online" mode we also keep a 30 s refresh so presence stays current.
  useEffect(() => {
    if (!shouldRunChat) {
      return;
    }

    let cancelled = false;

    const loadChat = async () => {
      setIsChatLoading(true);
      setChatError(null);

      try {
        const params = new URLSearchParams({ mode: chatMode });
        if (chatMode === "video") {
          params.set("videoId", currentVideo.id);
        }

        const response = await fetchWithAuthRetry(`/api/chat?${params.toString()}`);

        if (response.status === 401 || response.status === 403) {
          if (!cancelled) {
            setIsAuthenticated(false);
            setChatError(null);
          }
          return;
        }

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          if (!cancelled) {
            setChatError(payload?.error ?? "Chat failed to load.");
          }
          return;
        }

        const payload = (await response.json()) as { messages?: ChatMessage[]; onlineUsers?: OnlineUser[] };
        if (!cancelled) {
          setChatMessages(Array.isArray(payload.messages) ? payload.messages : []);
          setOnlineUsers(Array.isArray(payload.onlineUsers) ? payload.onlineUsers : []);
        }
      } catch {
        if (!cancelled) {
          setChatError("Chat failed to load.");
        }
      } finally {
        if (!cancelled) {
          setIsChatLoading(false);
        }
      }
    };

    void loadChat();

    // Only the "online" presence tab needs periodic refresh.
    const intervalId =
      chatMode === "online"
        ? window.setInterval(() => { void loadChat(); }, 30_000)
        : undefined;

    return () => {
      cancelled = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [chatMode, currentVideo.id, fetchWithAuthRetry, shouldRunChat]);

  // Real-time SSE subscriptions for global + current video chat.
  useEffect(() => {
    if (!shouldRunChat) {
      return;
    }

    const handleIncomingMessage = (event: MessageEvent<string>) => {
      try {
        const message = JSON.parse(event.data) as ChatMessage;

        const isGlobalMessage = message.room === "global";
        const isVideoMessage = message.room === "video" && message.videoId === currentVideo.id;
        const incomingMode: FlashableChatMode | null = isGlobalMessage
          ? "global"
          : isVideoMessage
            ? "video"
            : null;

        if (!incomingMode) {
          return;
        }

        if (chatModeRef.current !== incomingMode) {
          triggerChatTabFlash(incomingMode);
          return;
        }

        setChatMessages((current) => {
          // Deduplicate: the sender already added this via the POST response.
          if (current.some((m) => m.id === message.id)) return current;
          return [...current, message];
        });
      } catch {
        // ignore malformed events
      }
    };

    const globalEvents = new EventSource("/api/chat/stream?mode=global");
    const videoEvents = new EventSource(`/api/chat/stream?mode=video&videoId=${encodeURIComponent(currentVideo.id)}`);

    globalEvents.onmessage = handleIncomingMessage;
    videoEvents.onmessage = handleIncomingMessage;

    globalEvents.onerror = () => {
      // EventSource auto-reconnects; nothing to do here.
    };

    videoEvents.onerror = () => {
      // EventSource auto-reconnects; nothing to do here.
    };

    return () => {
      globalEvents.close();
      videoEvents.close();
    };
  }, [currentVideo.id, shouldRunChat]);

  useEffect(() => {
    return () => {
      for (const mode of ["global", "video"] as const) {
        const timeoutId = flashTimeoutRef.current[mode];
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
      }
    };
  }, []);

  useEffect(() => {
    if (shouldRunChat) {
      return;
    }

    setChatDraft("");
    setChatError(null);
    setChatMessages([]);
    setOnlineUsers([]);
    setIsChatLoading(false);
    setIsChatSubmitting(false);
    setChatMode("global");
  }, [isAuthenticated]);

  useEffect(() => {
    const node = chatListRef.current;
    if (!node) {
      return;
    }

    node.scrollTop = node.scrollHeight;
  }, [chatMessages]);

  const sourceRelatedVideos = dedupeVideoList(relatedVideos);
  const uniqueRelatedVideos = filterHiddenRelatedVideos(
    dedupeRelatedRailVideos(sourceRelatedVideos, currentVideo.id),
    hiddenVideoIdsRef.current,
  );
  const displayedRenderableRelatedVideos = filterHiddenRelatedVideos(
    dedupeRelatedRailVideos(displayedRelatedVideos, currentVideo.id),
    hiddenVideoIdsRef.current,
  );
  const visibleWatchNextVideos = isAuthenticated && watchNextHideSeen
    ? displayedRenderableRelatedVideos.filter((video) => !seenVideoIdsRef.current.has(video.id))
    : displayedRenderableRelatedVideos;
  const hasSeenWatchNextVideos = displayedRenderableRelatedVideos.some((video) => seenVideoIdsRef.current.has(video.id));

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

  useEffect(() => {
    relatedVideosRef.current = relatedVideos;
  }, [relatedVideos]);

  useEffect(() => {
    const handleWatchHistoryUpdated = (event: Event) => {
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
  }, [currentVideo.id]);

  const activePlaylistSummary = activePlaylistId
    ? playlistRailSummaries.find((playlist) => playlist.id === activePlaylistId) ?? null
    : null;
  const activePlaylistTrackCount = playlistRailData
    ? Math.max(playlistRailData.videos.length, playlistRailData.itemCount ?? activePlaylistSummary?.itemCount ?? 0)
    : (activePlaylistSummary?.itemCount ?? 0);
  const isCreatingActivePlaylist = Boolean(
    activePlaylistId
    && playlistCreationPendingId === activePlaylistId
    && isPlaylistRailLoading,
  );

  const loadMoreRelatedVideos = useCallback(async () => {
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

    try {
      const existing = dedupeRelatedRailVideos(dedupeVideoList(relatedVideosRef.current), currentVideo.id);
      if (relatedFetchOffsetRef.current === null || relatedFetchOffsetRef.current < existing.length) {
        relatedFetchOffsetRef.current = existing.length;
      }
      const params = new URLSearchParams();
      params.set("v", currentVideo.id);
      params.set("count", String(RELATED_LOAD_BATCH_SIZE));
      params.set("offset", String(relatedFetchOffsetRef.current));

      const response = await fetch(`/api/current-video?${params.toString()}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as CurrentVideoResolvePayload & { hasMore?: boolean };
      const nextVideos = Array.isArray(payload.relatedVideos) ? payload.relatedVideos : [];
      const payloadHasMore = payload.hasMore !== false;
      relatedFetchOffsetRef.current = (relatedFetchOffsetRef.current ?? existing.length) + nextVideos.length;

      if (nextVideos.length === 0 && !payloadHasMore) {
        setHasMoreRelated(false);
        return;
      }

      setRelatedVideos((previous) => {
        const merged = dedupeRelatedRailVideos(dedupeVideoList([...previous, ...nextVideos]), currentVideo.id)
          .slice(0, RELATED_MAX_VIDEOS);
        return merged;
      });

      if (!payloadHasMore) {
        setHasMoreRelated(false);
        return;
      }

    } catch {
      // Ignore transient load-more failures and let the next scroll retry.
    } finally {
      relatedLoadInFlightRef.current = false;
      setIsLoadingMoreRelated(false);
    }
  }, [currentVideo.id, hasMoreRelated, isWatchNextVideoSelectionPending, rightRailMode]);

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
    if (remainingPx <= RELATED_LOAD_AHEAD_PX) {
      void loadMoreRelatedVideos();
    }
  }, [hasMoreRelated, isWatchNextVideoSelectionPending, loadMoreRelatedVideos, relatedTransitionPhase, rightRailMode]);

  const handleRelatedScroll = useCallback(() => {
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
    setIsLoadingMoreRelated(false);
    setHasMoreRelated(true);
  }, [currentVideo.id]);

  useEffect(() => {
    maybeLoadMoreIfNearEnd();
  }, [displayedRenderableRelatedVideos.length, maybeLoadMoreIfNearEnd]);

  useEffect(() => {
    if (
      isOverlayRoute
      || rightRailMode !== "watch-next"
      || relatedTransitionPhase !== "idle"
      || !hasMoreRelated
      || isLoadingMoreRelated
      || isWatchNextVideoSelectionPending
    ) {
      return;
    }

    if (
      displayedRenderableRelatedVideos.length === 0
      || displayedRenderableRelatedVideos.length >= RELATED_BACKGROUND_PREFETCH_TARGET
      || displayedRenderableRelatedVideos.length >= RELATED_MAX_VIDEOS
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadMoreRelatedVideos();
    }, RELATED_BACKGROUND_PREFETCH_DELAY_MS);

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
    if (
      !watchNextHideSeen
      || rightRailMode !== "watch-next"
      || relatedTransitionPhase !== "idle"
      || !hasMoreRelated
      || isLoadingMoreRelated
      || isWatchNextVideoSelectionPending
      || visibleWatchNextVideos.length > 0
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadMoreRelatedVideos();
    }, 160);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    hasMoreRelated,
    isLoadingMoreRelated,
    isWatchNextVideoSelectionPending,
    loadMoreRelatedVideos,
    relatedTransitionPhase,
    rightRailMode,
    visibleWatchNextVideos.length,
    watchNextHideSeen,
  ]);

  useEffect(() => {
    if (
      rightRailMode !== "watch-next"
      || !hasMoreRelated
      || isLoadingMoreRelated
      || relatedTransitionPhase !== "idle"
      || isWatchNextVideoSelectionPending
    ) {
      return;
    }

    const root = relatedStackRef.current;
    const sentinel = relatedLoadMoreSentinelRef.current;
    if (!root || !sentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreRelatedVideos();
        }
      },
      {
        root,
        rootMargin: `0px 0px ${RELATED_LOAD_AHEAD_PX}px 0px`,
        threshold: 0.01,
      },
    );

    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [
    displayedRenderableRelatedVideos.length,
    hasMoreRelated,
    isLoadingMoreRelated,
    isWatchNextVideoSelectionPending,
    loadMoreRelatedVideos,
    relatedTransitionPhase,
    rightRailMode,
  ]);

  // Kick off the fade-out as soon as the user selects a new video so the
  // animation overlaps the API round-trip rather than adding to it.
  // IMPORTANT: Do NOT clear displayedRelatedVideos here - let it fade out naturally,
  // then the timeout will clear it to prevent stale rehydration.
  useEffect(() => {
    if (shouldDisableRelatedRailTransition) {
      return;
    }

    if (isResolvingRequestedVideo || requestedVideoId !== currentVideo.id) {
      return;
    }

    if (!requestedVideoId || requestedVideoId === prevFadeVideoIdRef.current) return;
    prevFadeVideoIdRef.current = requestedVideoId;
    
    // Save the video ID we're transitioning FROM so loading phase knows we've moved to new video.
    transitionFromVideoIdRef.current = currentVideo.id;
    
    // Trigger fade-out. Do NOT clear videos or pending refs yet.
    // The timeout after fade-out will handle discarding stale cards.
    setRelatedTransitionPhase((prev) => (prev === "idle" ? "fading-out" : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVideo.id, isResolvingRequestedVideo, requestedVideoId, shouldDisableRelatedRailTransition]);

  useEffect(() => {
    // If we're still resolving the requested video, wait.
    if (requestedVideoId && isResolvingRequestedVideo && currentVideo.id === requestedVideoId) {
      return;
    }

    const currentSignature = displayedRelatedVideos.map((video) => video.id).join("|");
    const nextSignature = sourceRelatedVideos.map((video) => video.id).join("|");

    // Disabled transitions: immediately apply new videos.
    if (shouldDisableRelatedRailTransition) {
      pendingRelatedVideosRef.current = null;
      if (currentSignature !== nextSignature) {
        setDisplayedRelatedVideos(sourceRelatedVideos);
      }
      if (relatedTransitionPhase !== "idle") {
        setRelatedTransitionPhase("idle");
      }
      return;
    }

    // No change to videos: nothing to do.
    if (currentSignature === nextSignature) {
      return;
    }

    // LOADING PHASE: waiting for new videos after video selection.
    // Once they arrive (displayedRelatedVideos empty, sourceRelatedVideos not empty),
    // immediately display them and transition to fading-in.
    if (relatedTransitionPhase === "loading") {
      if (displayedRelatedVideos.length === 0 && sourceRelatedVideos.length > 0) {
        // New videos candidates exist. But only display if:
        // 1. We've definitely moved to a new video (currentVideo.id changed from when we started fading-out)
        // 2. Video selection is complete (either no pending request, or currentVideo matches requested)
        const hasMovedToNewVideo = transitionFromVideoIdRef.current !== null && currentVideo.id !== transitionFromVideoIdRef.current;
        const isSelectionComplete = !requestedVideoId || currentVideo.id === requestedVideoId;
        
        if (hasMovedToNewVideo && isSelectionComplete) {
          // Definitely new videos from a new video: display and transition to fade-in.
          setDisplayedRelatedVideos(sourceRelatedVideos);
          pendingRelatedVideosRef.current = null;
          transitionFromVideoIdRef.current = null;
          setRelatedTransitionPhase("fading-in");
        }
      }
      // Stay in loading until confirmed new videos arrive.
      return;
    }

    // FADING-OUT or FADING-IN: block all signature-sync updates to prevent interference.
    // The timeout effects handle all state changes during animations.
    if (relatedTransitionPhase === "fading-out" || relatedTransitionPhase === "fading-in") {
      // Do NOT process video changes during animations.
      // Let the timeout handle all transitions.
      return;
    }

    // IDLE PHASE: videos have changed, need to transition.
    if (displayedRelatedVideos.length === 0) {
      // No videos shown currently: just display the new ones.
      setDisplayedRelatedVideos(sourceRelatedVideos);
      return;
    }

    // Videos differ and we're idle: start transition sequence.
    pendingRelatedVideosRef.current = sourceRelatedVideos;
    setRelatedTransitionPhase("fading-out");
  }, [
    currentVideo.id,
    displayedRelatedVideos,
    isResolvingRequestedVideo,
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

    if (relatedTransitionPhase === "fading-out") {
      if (relatedStackRef.current) {
        relatedStackRef.current.scrollTop = 0;
      }
      if (watchNextRailRef.current) {
        watchNextRailRef.current.scrollTop = 0;
      }
      const delayMs = RELATED_FADE_OUT_BASE_MS + RELATED_FADE_STAGGER_MS * Math.max(0, displayedRelatedVideos.length - 1);
      relatedTransitionTimeoutRef.current = window.setTimeout(() => {
        // After fade-out completes, clear stale cards and go to loading state.
        setDisplayedRelatedVideos([]);
        setRelatedTransitionPhase("loading");
      }, delayMs);
      return;
    }

    if (relatedTransitionPhase === "fading-in") {
      // Videos should already be displayed by the time we enter fading-in.
      // Just set up the timeout to end the animation and return to idle.
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
    const playlistHideTimeouts = playlistItemHideTimeoutsRef.current;

    return () => {
      if (relatedClickFlashTimeoutRef.current !== null) {
        window.clearTimeout(relatedClickFlashTimeoutRef.current);
        relatedClickFlashTimeoutRef.current = null;
      }

      for (const timeoutId of hideTimeouts.values()) {
        window.clearTimeout(timeoutId);
      }
      hideTimeouts.clear();

      for (const timeoutId of playlistHideTimeouts.values()) {
        window.clearTimeout(timeoutId);
      }
      playlistHideTimeouts.clear();
    };
  }, []);

  const commitPlaylistTrackRemoval = useCallback((slotKey: string, playlistItemIndex: number) => {
    setHidingPlaylistTrackKeys((previous) => {
      if (previous.includes(slotKey)) {
        return previous;
      }

      return [...previous, slotKey];
    });

    const existingTimeoutId = playlistItemHideTimeoutsRef.current.get(slotKey);
    if (existingTimeoutId !== undefined) {
      window.clearTimeout(existingTimeoutId);
    }

    const timeoutId = window.setTimeout(() => {
      setPlaylistRailData((previous) => {
        if (!previous) {
          return previous;
        }

        if (playlistItemIndex < 0 || playlistItemIndex >= previous.videos.length) {
          return previous;
        }

        return {
          ...previous,
          videos: previous.videos.filter((_, index) => index !== playlistItemIndex),
        };
      });
      setHidingPlaylistTrackKeys((previous) => previous.filter((candidateKey) => candidateKey !== slotKey));
      playlistItemHideTimeoutsRef.current.delete(slotKey);
    }, WATCH_NEXT_HIDE_ANIMATION_MS);

    playlistItemHideTimeoutsRef.current.set(slotKey, timeoutId);
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

  const handleHideFromWatchNext = useCallback(async (track: VideoRecord) => {
    if (!isAuthenticated) {
      setPlaylistMutationTone("error");
      setPlaylistMutationMessage("Sign in to hide tracks from Watch Next.");
      return;
    }

    if (hidingRelatedVideoIds.includes(track.id) || hiddenMutationPendingVideoIds.includes(track.id)) {
      return;
    }

    commitWatchNextHide(track.id);
    setHiddenMutationPendingVideoIds((previous) => [...previous, track.id]);

    try {
      const response = await fetchWithAuthRetry("/api/hidden-videos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ videoId: track.id }),
      });

      if (response.status === 401 || response.status === 403) {
        setIsAuthenticated(false);
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Sign in to hide tracks from Watch Next.");
        return;
      }

      if (!response.ok) {
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Track removed, but hidden preference could not be saved.");
      }
    } catch {
      setPlaylistMutationTone("error");
      setPlaylistMutationMessage("Track removed, but hidden preference could not be saved.");
    } finally {
      setHiddenMutationPendingVideoIds((previous) => previous.filter((videoId) => videoId !== track.id));
    }
  }, [commitWatchNextHide, fetchWithAuthRetry, hiddenMutationPendingVideoIds, hidingRelatedVideoIds, isAuthenticated]);

  const handleRemoveTrackFromActivePlaylist = useCallback(async (track: PlaylistRailVideo, playlistItemIndex: number) => {
    if (!activePlaylistId) {
      return;
    }

    const slotKey = track.playlistItemId ?? `${track.id}:${playlistItemIndex}`;

    if (hidingPlaylistTrackKeys.includes(slotKey) || playlistItemMutationPendingKeys.includes(slotKey)) {
      return;
    }

    commitPlaylistTrackRemoval(slotKey, playlistItemIndex);
    setPlaylistItemMutationPendingKeys((previous) => [...previous, slotKey]);

    try {
      const response = await fetchWithAuthRetry(`/api/playlists/${encodeURIComponent(activePlaylistId)}/items`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ playlistItemId: track.playlistItemId, playlistItemIndex }),
      });

      if (response.status === 401 || response.status === 403) {
        setIsAuthenticated(false);
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Sign in to edit playlists.");
        return;
      }

      if (!response.ok) {
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Track removed visually, but playlist update failed.");
        return;
      }

      const updatedPlaylist = (await response.json().catch(() => null)) as PlaylistRailPayload | null;

      setPlaylistRailSummaries((previous) =>
        previous.map((summary) =>
          summary.id === activePlaylistId
            ? {
                ...summary,
                itemCount: updatedPlaylist?.videos.length ?? Math.max(0, summary.itemCount - 1),
                leadVideoId: updatedPlaylist?.videos[0]?.id ?? "__placeholder__",
              }
            : summary,
        ),
      );

      if (updatedPlaylist?.id === activePlaylistId && Array.isArray(updatedPlaylist.videos)) {
        setPlaylistRailData(updatedPlaylist);
      }
    } catch {
      setPlaylistMutationTone("error");
      setPlaylistMutationMessage("Track removed visually, but playlist update failed.");
    } finally {
      setPlaylistItemMutationPendingKeys((previous) => previous.filter((candidateKey) => candidateKey !== slotKey));
    }
  }, [activePlaylistId, commitPlaylistTrackRemoval, fetchWithAuthRetry, hidingPlaylistTrackKeys, playlistItemMutationPendingKeys]);

  const handleReorderActivePlaylistTrack = useCallback(async (fromIndex: number, toIndex: number) => {
    if (!activePlaylistId || fromIndex === toIndex) {
      return;
    }

    const currentPlaylist = playlistRailData;

    if (!currentPlaylist || !Array.isArray(currentPlaylist.videos)) {
      return;
    }

    if (
      fromIndex < 0
      || toIndex < 0
      || fromIndex >= currentPlaylist.videos.length
      || toIndex >= currentPlaylist.videos.length
    ) {
      return;
    }

    // Read item IDs before state changes (safe — human-speed clicks always have fresh closure).
    const fromPlaylistItemId = currentPlaylist.videos[fromIndex]?.playlistItemId;
    const toPlaylistItemId = currentPlaylist.videos[toIndex]?.playlistItemId;

    // Optimistic update via functional form so rapid queued calls each build on the latest state.
    playlistRailMutationVersionRef.current += 1;
    setPlaylistRailData((prev) => {
      if (!prev || !Array.isArray(prev.videos)) return prev;
      if (fromIndex >= prev.videos.length || toIndex >= prev.videos.length) return prev;
      const reorderedVideos = [...prev.videos];
      const [moved] = reorderedVideos.splice(fromIndex, 1);
      if (!moved) return prev;
      reorderedVideos.splice(toIndex, 0, moved);
      return { ...prev, videos: reorderedVideos };
    });

    // Sequence number: only the latest response updates persisted state.
    const seq = ++reorderSeqRef.current;

    try {
      const response = await fetchWithAuthRetry(`/api/playlists/${encodeURIComponent(activePlaylistId)}/items`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fromPlaylistItemId,
          toPlaylistItemId,
          fromIndex,
          toIndex,
        }),
      });

      // A newer reorder was initiated while this one was in flight — discard this response.
      if (seq < reorderSeqRef.current) {
        return;
      }

      if (response.status === 401 || response.status === 403) {
        setIsAuthenticated(false);
        setPlaylistRailData(currentPlaylist);
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Sign in to edit playlists.");
        return;
      }

      if (!response.ok) {
        setPlaylistRailData(currentPlaylist);
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Could not reorder playlist tracks.");
        return;
      }

      const updatedPlaylist = (await response.json().catch(() => null)) as PlaylistRailPayload | null;

      if (updatedPlaylist?.id === activePlaylistId && Array.isArray(updatedPlaylist.videos)) {
        setPlaylistRailData(updatedPlaylist);
        setPlaylistRailSummaries((previous) =>
          previous.map((summary) =>
            summary.id === activePlaylistId
              ? {
                  ...summary,
                  itemCount: updatedPlaylist.videos.length,
                  leadVideoId: updatedPlaylist.videos[0]?.id ?? "__placeholder__",
                }
              : summary,
          ),
        );
      }
    } catch {
      if (seq >= reorderSeqRef.current) {
        setPlaylistRailData(currentPlaylist);
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Could not reorder playlist tracks.");
      }
    }
  }, [activePlaylistId, fetchWithAuthRetry, playlistRailData]);

  const handlePlaylistTrackDragStart = useCallback((event: ReactDragEvent<HTMLDivElement>, index: number) => {
    event.stopPropagation();
    setDraggedPlaylistTrackIndex(index);
    setDragOverPlaylistTrackIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  }, []);

  const handlePlaylistTrackDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>, index: number) => {
    event.preventDefault();
    if (dragOverPlaylistTrackIndex !== index) {
      setDragOverPlaylistTrackIndex(index);
    }
  }, [dragOverPlaylistTrackIndex]);

  const handlePlaylistTrackDrop = useCallback((event: ReactDragEvent<HTMLDivElement>, toIndex: number) => {
    event.preventDefault();
    const fromIndex = draggedPlaylistTrackIndex;
    setDraggedPlaylistTrackIndex(null);
    setDragOverPlaylistTrackIndex(null);

    if (fromIndex === null || fromIndex === toIndex) {
      return;
    }

    void handleReorderActivePlaylistTrack(fromIndex, toIndex);
  }, [draggedPlaylistTrackIndex, handleReorderActivePlaylistTrack]);

  const handlePlaylistTrackDragEnd = useCallback(() => {
    setDraggedPlaylistTrackIndex(null);
    setDragOverPlaylistTrackIndex(null);
  }, []);

  const visibleNavItems = (
    isAuthenticated
      ? navItems
      : navItems.filter(
          (item) =>
            !["/favourites", "/playlists", "/history", "/account"].includes(item.href),
        )
  ).filter((item) => item.href !== "/" && item.href !== "/ai");

  function getNavHref(href: string) {
    const params = new URLSearchParams();
    params.set("v", currentVideo.id);
    params.set("resume", "1");

    if (href === "/artists") {
      params.set("letter", activeArtistLetter);
    }

    return `${href}?${params.toString()}`;
  }

  function getRelatedThumbnail(id: string) {
    return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
  }

  function getActivatePlaylistHref(playlistId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("v", currentVideo.id);
    params.set("resume", "1");
    params.set("pl", playlistId);
    params.delete("pli");
    return `/?${params.toString()}`;
  }

  function getClosePlaylistHref() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("v", currentVideo.id);
    params.set("resume", "1");
    params.delete("pl");
    params.delete("pli");
    const query = params.toString();
    return query.length > 0 ? `/?${query}` : "/";
  }

  const handleSwitchToWatchNextRail = useCallback(() => {
    setRightRailMode("watch-next");

    if (!activePlaylistId) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("v", currentVideo.id);
    params.set("resume", "1");
    params.delete("pl");
    params.delete("pli");

    const query = params.toString();
    router.replace(query ? `/?${query}` : "/");
  }, [activePlaylistId, currentVideo.id, router, searchParams]);

  async function handleDeleteActivePlaylist() {
    if (!activePlaylistId || isDeletingActivePlaylist) {
      return;
    }

    setIsDeletingActivePlaylist(true);

    try {
      const response = await fetchWithAuthRetry(`/api/playlists/${encodeURIComponent(activePlaylistId)}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Could not delete playlist.");
        return;
      }

      window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
      setPlaylistRailData(null);
      setPlaylistRailError(null);
      router.push(getClosePlaylistHref());
    } catch {
      setPlaylistMutationTone("error");
      setPlaylistMutationMessage("Could not delete playlist.");
    } finally {
      setIsDeletingActivePlaylist(false);
    }
  }

  useEffect(() => {
    if (!activePlaylistId) {
      setShowDeleteActivePlaylistConfirm(false);
    }
  }, [activePlaylistId]);

  useEffect(() => {
    if (rightRailMode !== "playlist") {
      setConfirmDeleteRailPlaylist(null);
    }
  }, [rightRailMode]);

  async function handleDeletePlaylistFromRail(playlistId: string) {
    if (playlistBeingDeletedId) {
      return;
    }

    setPlaylistBeingDeletedId(playlistId);

    try {
      const response = await fetchWithAuthRetry(`/api/playlists/${encodeURIComponent(playlistId)}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        return;
      }

      window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
      setPlaylistRailSummaries((current) => current.filter((p) => p.id !== playlistId));
    } catch {
      // Silent failure
    } finally {
      setPlaylistBeingDeletedId(null);
    }
  }

  async function handleCreatePlaylistFromRail() {
    if (isCreatingRailPlaylist) {
      return;
    }

    setIsCreatingRailPlaylist(true);
    setPlaylistMutationTone("info");
    setPlaylistMutationMessage(null);

    try {
      const response = await fetchWithAuthRetry("/api/playlists", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: buildGeneratedPlaylistName(),
          videoIds: [],
        }),
      });

      if (response.status === 401 || response.status === 403) {
        setIsAuthenticated(false);
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Sign in to create playlists.");
        return;
      }

      if (!response.ok) {
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Could not create playlist.");
        return;
      }

      const created = (await response.json()) as { id?: string };
      if (!created.id) {
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Playlist was created but could not be opened.");
        return;
      }

      setPlaylistCreationPendingId(created.id);
      window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
      router.replace(getActivatePlaylistHref(created.id));
    } catch {
      setPlaylistMutationTone("error");
      setPlaylistMutationMessage("Could not create playlist.");
    } finally {
      setIsCreatingRailPlaylist(false);
    }
  }

  function prewarmRelatedThumbnail(videoId: string) {
    if (typeof window === "undefined") {
      return;
    }

    if (prewarmedThumbnailIdsRef.current.has(videoId)) {
      return;
    }

    prewarmedThumbnailIdsRef.current.add(videoId);
    const img = new window.Image();
    img.decoding = "async";
    img.src = getRelatedThumbnail(videoId);
  }

  function prefetchCurrentVideoPayload(videoId: string) {
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
    void fetch(`/api/current-video?v=${encodeURIComponent(videoId)}`, {
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

        if (data.currentVideo?.id === videoId) {
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
  }

  function prefetchRelatedSelection(video: VideoRecord) {
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

  async function handleAddToPlaylistFromWatchNext(track: VideoRecord) {
    if (playlistMutationPendingVideoId) {
      return;
    }

    setPlaylistMutationPendingVideoId(track.id);
    setPlaylistMutationMessage(null);
    setPlaylistMutationTone("info");

    try {
      const effectivePlaylistId = activePlaylistId ?? pendingCreatedPlaylistIdRef.current;

      if (effectivePlaylistId) {
        const addResponse = await fetchWithAuthRetry(`/api/playlists/${encodeURIComponent(effectivePlaylistId)}/items`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ videoId: track.id }),
        });

        if (addResponse.status === 401 || addResponse.status === 403) {
          setIsAuthenticated(false);
          setPlaylistMutationTone("error");
          setPlaylistMutationMessage("Sign in to save tracks to playlists.");
          return;
        }

        if (!addResponse.ok) {
          setPlaylistMutationTone("error");
          setPlaylistMutationMessage("Could not add track to playlist.");
          return;
        }

        setLastAddedRelatedVideoId(track.id);
        setPlaylistRailData((prev) =>
          prev ? { ...prev, itemCount: Math.max(prev.videos.length, prev.itemCount ?? 0) + 1 } : prev,
        );
        return;
      }

      const createResponse = await fetchWithAuthRetry("/api/playlists", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: buildGeneratedPlaylistName(),
          videoIds: [],
        }),
      });

      if (createResponse.status === 401 || createResponse.status === 403) {
        setIsAuthenticated(false);
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Sign in to create playlists.");
        return;
      }

      if (!createResponse.ok) {
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Could not create playlist.");
        return;
      }

      const created = (await createResponse.json()) as { id?: string };

      if (!created.id) {
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Playlist was created but could not be opened.");
        return;
      }

      const addResponse = await fetchWithAuthRetry(`/api/playlists/${encodeURIComponent(created.id)}/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ videoId: track.id }),
      });

      if (addResponse.status === 401 || addResponse.status === 403) {
        setIsAuthenticated(false);
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Sign in to save tracks to playlists.");
        return;
      }

      if (!addResponse.ok) {
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Playlist created, but this track could not be added.");
        return;
      }

      setLastAddedRelatedVideoId(track.id);
      pendingCreatedPlaylistIdRef.current = created.id;
      suppressPlaylistRailAutoSwitchRef.current = true;
      const params = new URLSearchParams(searchParams.toString());
      params.set("v", currentVideo.id);
      params.set("resume", "1");
      params.set("pl", created.id);
      params.delete("pli");
      router.replace(`/?${params.toString()}`);
    } catch {
      setPlaylistMutationTone("error");
      setPlaylistMutationMessage("Could not update playlists right now.");
    } finally {
      setPlaylistMutationPendingVideoId(null);
    }
  }

  useEffect(() => {
    if (!playlistMutationMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPlaylistMutationMessage(null);
    }, 2500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [playlistMutationMessage]);

  useEffect(() => {
    if (!lastAddedRelatedVideoId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setLastAddedRelatedVideoId(null);
    }, 1800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [lastAddedRelatedVideoId]);

  async function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (chatMode === "online") {
      return;
    }

    const content = chatDraft.trim();
    if (!content) {
      return;
    }

    setIsChatSubmitting(true);
    setChatError(null);

    try {
      const response = await fetchWithAuthRetry("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: chatMode,
          videoId: chatMode === "video" ? currentVideo.id : undefined,
          content,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        setIsAuthenticated(false);
        setChatError(null);
        return;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setChatError(payload?.error ?? "Unable to send message.");
        return;
      }

      const payload = (await response.json()) as { message?: ChatMessage };
      if (payload.message) {
        setChatMessages((current) => {
          if (current.some((message) => message.id === payload.message?.id)) {
            return current;
          }
          return [...current, payload.message as ChatMessage];
        });
      }
      setChatDraft("");
    } catch {
      setChatError("Unable to send message.");
    } finally {
      setIsChatSubmitting(false);
    }
  }

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

    const checkAuthState = async () => {
      try {
        const response = await fetchWithAuthRetry("/api/auth/me");

        if (cancelled) {
          return;
        }

        if (response.status === 401 || response.status === 403) {
          authProbeFailureCountRef.current += 1;

          if (authProbeFailureCountRef.current >= AUTH_PROBE_FAILURE_THRESHOLD) {
            setIsAuthenticated(false);
            setChatError(null);
          }

          return;
        }

        authProbeFailureCountRef.current = 0;
      } catch {
        // Ignore transient network errors and keep current UI state.
      }
    };

    void checkAuthState();
    const intervalId = window.setInterval(() => {
      void checkAuthState();
    }, 60_000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkAuthState();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchWithAuthRetry, isAuthenticated]);

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

  // Dismiss suggestions when clicking outside the combobox
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (searchComboboxRef.current && !searchComboboxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
        setActiveSuggestionIdx(-1);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    return () => {
      if (suggestDebounceRef.current) {
        clearTimeout(suggestDebounceRef.current);
        suggestDebounceRef.current = null;
      }

      if (suggestAbortRef.current) {
        suggestAbortRef.current.abort();
        suggestAbortRef.current = null;
      }
    };
  }, []);

  function handleSearchInput(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setSearchValue(value);
    setActiveSuggestionIdx(-1);

    if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);

    const trimmed = value.trim();
    latestSuggestQueryRef.current = trimmed;

    if (suggestAbortRef.current) {
      suggestAbortRef.current.abort();
      suggestAbortRef.current = null;
    }

    if (!trimmed || trimmed.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    suggestDebounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      suggestAbortRef.current = controller;

      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        if (res.ok) {
          const data = await res.json() as { suggestions: SearchSuggestion[] };
          if (latestSuggestQueryRef.current !== trimmed) {
            return;
          }
          setSuggestions(data.suggestions);
          setShowSuggestions(data.suggestions.length > 0);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        // non-critical — ignore suggest failures silently
      } finally {
        if (suggestAbortRef.current === controller) {
          suggestAbortRef.current = null;
        }
      }
    }, 140);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const isOpen = showSuggestions && suggestions && suggestions.length > 0;

    if (e.key === "ArrowDown") {
      if (isOpen) {
        e.preventDefault();
        e.stopPropagation();
        setActiveSuggestionIdx((prev) => Math.min(prev + 1, suggestions!.length - 1));
      }
    } else if (e.key === "ArrowUp") {
      if (isOpen) {
        e.preventDefault();
        e.stopPropagation();
        setActiveSuggestionIdx((prev) => Math.max(prev - 1, -1));
      }
    } else if (e.key === "Escape") {
      if (isOpen) {
        e.preventDefault();
        e.stopPropagation();
        setShowSuggestions(false);
        setActiveSuggestionIdx(-1);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();

      // Only navigate to a suggestion when one is explicitly highlighted.
      if (isOpen && suggestions && activeSuggestionIdx >= 0) {
        const selected = suggestions[activeSuggestionIdx];
        if (selected) {
          handleSuggestionClick(selected);
          return;
        }
      }

      // No dropdown - search with the query text
      if (searchValue.trim()) {
        router.push(`/search?q=${encodeURIComponent(searchValue.trim())}&v=${encodeURIComponent(currentVideo.id)}`);
        setShowSuggestions(false);
        setSearchValue("");
      }
    }
  }

  function handleSuggestionClick(suggestion: SearchSuggestion) {
    const url = suggestion.type === "track"
      ? suggestion.url
      : `${suggestion.url}?v=${encodeURIComponent(currentVideo.id)}&resume=1`;
    setShowSuggestions(false);
    setSearchValue("");
    router.push(url);
  }

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

      {isDesktopIntroActive ? (
        <div className="desktopIntroOverlay" aria-hidden="true">
          <Image
            src="/assets/images/yeh4.png"
            alt=""
            width={306}
            height={102}
            priority
            className="desktopIntroLogo"
          />
        </div>
      ) : null}

      <header className="topbar">
        <div className="brandLockup">
          <Link href="/" aria-label="Yeh That Rocks home" ref={brandLogoTargetRef} onClick={handleBrandLogoClick}>
            <Image
              src="/assets/images/yeh4.png"
              alt="Yeh That Rocks"
              width={306}
              height={102}
              priority
              className="brandLogo"
            />
          </Link>
          <h1 className="brandTagline">The world&apos;s loudest website</h1>
        </div>

        <div className="headerBar">
          <nav className="mainNav" aria-label="Primary">
            {visibleNavItems.map((item) => {
              const isActive = isRouteActive(item.href, pathname);
              return (
                <Link
                  key={item.href}
                  href={getNavHref(item.href)}
                  className={isActive ? "navLink navLinkActive" : "navLink"}
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

      <section
        className={[
          "heroGrid",
          shouldShowOverlayPanel ? "heroGridOverlayRoute" : "",
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
            shouldShowOverlayPanel ? "railOccluded" : "",
            isMobileViewport ? "mobileRail" : "",
            isMobileViewport && !isMobileCommunityOpen ? "mobileRailClosed" : "",
          ].filter(Boolean).join(" ")}
          aria-hidden={isLeftRailSuppressed}
          inert={isLeftRailSuppressed ? true : undefined}
        >
          {isAuthenticated ? (
            <>
              <div className="railTabs">
                <button
                  type="button"
                  className={`${chatMode === "global" ? "activeTab" : ""} ${flashingChatTabs.global ? "attentionPulse" : ""}`.trim() || undefined}
                  onClick={() => setChatMode("global")}
                >
                  Global Chat
                </button>
                <button
                  type="button"
                  className={`${chatMode === "video" ? "activeTab" : ""} ${flashingChatTabs.video ? "attentionPulse" : ""}`.trim() || undefined}
                  onClick={() => setChatMode("video")}
                >
                  Video Chat
                </button>
                <button
                  type="button"
                  className={chatMode === "online" ? "activeTab" : undefined}
                  onClick={() => setChatMode("online")}
                >
                  Who&apos;s Online
                </button>
              </div>

              <div className="chatList" ref={chatListRef}>
                {isChatLoading ? <p className="chatStatus">Loading chat...</p> : null}
                {!isChatLoading && chatMode !== "online" && chatMessages.length === 0 ? (
                  <p className="chatStatus">
                    {chatMode === "global"
                      ? "No global messages yet. Start the noise."
                      : "No messages for this video yet. Say something about the current track."}
                  </p>
                ) : null}
                {chatMode === "online" ? (
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
                          <Image src={user.avatarUrl} alt="" width={88} height={88} className="chatAvatar" />
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
                          <Image src={message.user.avatarUrl} alt="" width={88} height={88} className="chatAvatar" />
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

              {chatMode !== "online" ? (
                <>
                  <form className="chatComposer" onSubmit={handleChatSubmit}>
                    <input
                      type="text"
                      placeholder={chatMode === "global" ? "Message the global room..." : `Talk about ${currentVideo.title}...`}
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
              ) : null}
            </>
          ) : (
            <div className="guestRail">
              <div className="panelHeading guestRailHeading">
                <span>Members only</span>
                <strong>
                  Sign in to join chat, save favourites, and build playlists
                </strong>
              </div>

              <AuthLoginForm />

              <div className="guestRailActions">
                <Link href="/register" className="navLink">
                  Create account
                </Link>
                <Link href="/forgot-password" className="navLink">
                  Forgot password?
                </Link>
              </div>
            </div>
          )}
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
                {isResolvingInitialVideo || isResolvingRequestedVideo ? (
                  <div className="playerLoadingFallback" role="status" aria-live="polite" aria-label={routeLoadingLabel}>
                    <div className="playerBootLoader">
                      <div className="playerBootBars" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                        <span />
                      </div>
                      <p>{routeLoadingMessage}</p>
                    </div>
                  </div>
                ) : (
                  <PlayerExperience
                    currentVideo={currentVideo}
                    queue={[currentVideo, ...uniqueRelatedVideos]}
                    isLoggedIn={isAuthenticated}
                    isAdmin={isAdmin}
                    isDockedDesktop={shouldDockDesktopPlayer}
                    seenVideoIds={seenVideoIdsRef.current}
                    onHideVideo={handleHideFromWatchNext}
                    onAddVideoToPlaylist={handleAddToPlaylistFromWatchNext}
                    forcedUnavailableSignal={forcedUnavailableSignal}
                    forcedUnavailableMessage={forcedUnavailableMessage}
                  />
                )}
              </Suspense>
            </div>

            {shouldShowOverlayPanel ? (
              <section
                key={overlayRouteKey}
                className={overlayPanelClassName}
                aria-label="Page overlay"
              >
                <div ref={favouritesBlindInnerRef} className="favouritesBlindInner">
                  {isOverlayRoute ? children : (
                    <div className="playerLoadingFallback" role="status" aria-live="polite" aria-label={routeLoadingLabel}>
                      <div className="playerBootLoader">
                        <div className="playerBootBars" aria-hidden="true">
                          <span />
                          <span />
                          <span />
                          <span />
                        </div>
                        <p>{routeLoadingMessage}</p>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            ) : null}
          </div>
        </section>

        <aside
          ref={watchNextRailRef}
          className={
            shouldShowOverlayPanel
              ? "rightRail panel translucent railOccluded"
              : "rightRail panel translucent"
          }
          aria-hidden={shouldShowOverlayPanel}
          inert={shouldShowOverlayPanel ? true : undefined}
        >
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

              {shouldShowWatchNextBootstrapLoader ? (
                <div className="relatedLoadingState" role="status" aria-live="polite" aria-busy="true">
                  <span className="playerBootBars" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </span>
                  <span>Loading Watch Next videos...</span>
                </div>
              ) : (
                <>
                  {relatedTransitionPhase === "loading" ? (
                    <div className="relatedLoadingState" role="status" aria-live="polite" aria-busy="true">
                      <span className="playerBootBars" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                        <span />
                      </span>
                      <span>Loading Watch Next videos...</span>
                    </div>
                  ) : null}

                  {visibleWatchNextVideos.map((track, index) => (
                    <div
                      key={track.id}
                      className={hidingRelatedVideoIds.includes(track.id) ? "relatedCardSlot relatedCardSlotExiting" : "relatedCardSlot"}
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
                            void handleHideFromWatchNext(track);
                          }}
                          disabled={hidingRelatedVideoIds.includes(track.id) || hiddenMutationPendingVideoIds.includes(track.id)}
                        >
                          ×
                        </button>
                      ) : null}
                      <Link
                        href={`/?v=${track.id}`}
                        className={`relatedCard linkedCard relatedCardTransition${clickedRelatedVideoId === track.id ? " relatedCardClickFlash" : ""}`}
                        onClick={() => {
                          setClickedRelatedVideoId(track.id);
                          if (relatedClickFlashTimeoutRef.current !== null) {
                            window.clearTimeout(relatedClickFlashTimeoutRef.current);
                          }
                          relatedClickFlashTimeoutRef.current = window.setTimeout(() => {
                            setClickedRelatedVideoId((activeId) => (activeId === track.id ? null : activeId));
                            relatedClickFlashTimeoutRef.current = null;
                          }, 240);
                        }}
                        onMouseEnter={() => prefetchRelatedSelection(track)}
                        onFocus={() => prefetchRelatedSelection(track)}
                        onPointerDown={() => prefetchRelatedSelection(track)}
                      >
                        <div className="thumbGlow">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={getRelatedThumbnail(track.id)}
                            alt={track.title}
                            loading={index < 3 ? "eager" : "lazy"}
                            fetchPriority={index < 2 ? "high" : "auto"}
                            className="relatedThumb"
                          />
                          {seenVideoIdsRef.current.has(track.id) ? <span className="videoSeenBadge videoSeenBadgeOverlay relatedSeenBadgeOverlay">Seen</span> : null}
                        </div>
                        <div>
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
                        <AddToPlaylistButton
                          videoId={track.id}
                          isAuthenticated={isAuthenticated}
                          className="relatedCardPlaylistAdd"
                          compact
                        />
                      ) : null}
                    </div>
                  ))}

                  {watchNextHideSeen && hasSeenWatchNextVideos && visibleWatchNextVideos.length === 0 ? (
                    <p className="rightRailStatus">No unseen videos in Watch Next right now.</p>
                  ) : null}

                  <div ref={relatedLoadMoreSentinelRef} className="relatedLoadMoreSentinel" aria-hidden="true" />

                  {isLoadingMoreRelated ? <p className="rightRailStatus">Loading more suggestions...</p> : null}
                </>
              )}
            </div>
          ) : (
            <div className="relatedStack relatedStackPlaylist">
              {activePlaylistId ? (
                <div className="rightRailPlaylistBar">
                  <span className="rightRailPlaylistLabel">
                    {playlistRailData
                      ? `${playlistRailData.name} • ${activePlaylistTrackCount} ${activePlaylistTrackCount === 1 ? "track" : "tracks"}`
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

              <div className="relatedStackPlaylistBody">

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
                            <Image
                              src={getRelatedThumbnail(playlist.leadVideoId)}
                              alt=""
                              width={128}
                              height={72}
                              unoptimized
                              loading="lazy"
                              className="relatedThumb"
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
                  const isCurrentPlaylistTrack = currentVideo.id === track.id;
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
                      onDragOver={(event) => { event.preventDefault(); setDragOverPlaylistTrackIndex(index); }}
                      onDrop={(event) => handlePlaylistTrackDrop(event, index)}
                    />
                  );
                  return [
                    ...(showPlaceholderAbove ? [placeholder(`rph-above-${index}`)] : []),
                    <div
                      key={track.playlistItemId ?? `${track.id}-${index}`}
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
                        draggable={false}
                      >
                        <div className="thumbGlow">
                          <Image
                            src={getRelatedThumbnail(track.id)}
                            alt={track.title}
                            width={128}
                            height={72}
                            unoptimized
                            loading={index < 3 ? "eager" : "lazy"}
                            fetchPriority={index < 2 ? "high" : "auto"}
                            className="relatedThumb"
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
      </section>
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
