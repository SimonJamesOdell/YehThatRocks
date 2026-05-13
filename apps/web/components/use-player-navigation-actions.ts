"use client";

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { LIVE_SEARCH_PARAMS_EVENT } from "@/components/use-live-search-params";

const AUTOPLAY_FALLBACK_POOL_SIZE = 12;
const RANDOM_NEXT_RECENT_EXCLUSION = 5;

export function usePlayerNavigationActions({
  pathname,
  searchParams,
  routerPush,
  currentVideoIdRef,
  currentVideoId,
  autoplayEnabledRef,
  autoplayRouteTransitionRef,
  nextVideoIdRef,
  nextClearPlaylistRef,
  activePlaylistIdRef,
  nextPlaylistIndexRef,
  pendingAutoAdvanceVideoIdRef,
  autoplayRecoveryRequestIdRef,
  historyStack,
  hasActivePlaylistIntent,
  setPlayerClosedByEndOfVideo,
  setEndedChoiceLoading,
  setShowEndedChoiceOverlay,
  setShowControls,
  setShowShareMenu,
}: {
  pathname: string;
  searchParams: URLSearchParams;
  routerPush: (href: string, options?: { scroll?: boolean }) => void;
  currentVideoIdRef: MutableRefObject<{ id: string }>;
  currentVideoId: string;
  autoplayEnabledRef: MutableRefObject<boolean>;
  autoplayRouteTransitionRef: MutableRefObject<boolean>;
  nextVideoIdRef: MutableRefObject<string | null>;
  nextClearPlaylistRef: MutableRefObject<boolean>;
  activePlaylistIdRef: MutableRefObject<string | null>;
  nextPlaylistIndexRef: MutableRefObject<number | null>;
  pendingAutoAdvanceVideoIdRef: MutableRefObject<string | null>;
  autoplayRecoveryRequestIdRef: MutableRefObject<number>;
  historyStack: string[];
  hasActivePlaylistIntent: boolean;
  setPlayerClosedByEndOfVideo: Dispatch<SetStateAction<boolean>>;
  setEndedChoiceLoading: Dispatch<SetStateAction<boolean>>;
  setShowEndedChoiceOverlay: Dispatch<SetStateAction<boolean>>;
  setShowControls: Dispatch<SetStateAction<boolean>>;
  setShowShareMenu: Dispatch<SetStateAction<boolean>>;
}) {
  const resolveAutoplayRecoveryTarget = useCallback(async () => {
    try {
      const response = await fetch(`/api/current-video?v=${encodeURIComponent(currentVideoIdRef.current.id)}&count=${AUTOPLAY_FALLBACK_POOL_SIZE}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            relatedVideos?: Array<{ id: string }>;
            videos?: Array<{ id: string }>;
          }
        | null;

      const currentId = currentVideoIdRef.current.id;
      const fallbackPool = Array.isArray(payload?.relatedVideos)
        ? payload.relatedVideos
        : Array.isArray(payload?.videos)
          ? payload.videos
          : [];
      const fallbackIds = Array.from(new Set(fallbackPool.map((video) => video.id))).filter((videoId) => Boolean(videoId) && videoId !== currentId);

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
  }, [currentVideoIdRef, historyStack]);

  const navigateToVideo = useCallback((
    videoId: string,
    options?: {
      clearPlaylist?: boolean;
      playlistId?: string | null;
      playlistItemIndex?: number | null;
      useNativeHistory?: boolean;
    },
  ) => {
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

    const nextHref = `${navigationPathname}?${params.toString()}`;

    if (options?.useNativeHistory && typeof window !== "undefined") {
      window.history.pushState(window.history.state, "", nextHref);
      window.dispatchEvent(new CustomEvent(LIVE_SEARCH_PARAMS_EVENT));
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    }

    routerPush(nextHref, { scroll: false });
  }, [pathname, routerPush, searchParams]);

  const triggerEndOfVideoAction = useCallback((options?: { forceAutoplayAdvance?: boolean }) => {
    const forceAutoplayAdvance = options?.forceAutoplayAdvance === true;
    const autoplayEnabledForCurrentTrack = autoplayEnabledRef.current && !autoplayRouteTransitionRef.current && currentVideoId.length > 0;

    const shouldAutoAdvance = autoplayEnabledForCurrentTrack || forceAutoplayAdvance;

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
      return;
    }

    if (shouldAutoAdvance && !hasActivePlaylistIntent) {
      const requestId = ++autoplayRecoveryRequestIdRef.current;
      const endedVideoId = currentVideoId;

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

        if (currentVideoIdRef.current.id !== endedVideoId) {
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
      const shouldCloseDockedSurface = pathname !== "/";

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
  }, [
    autoplayEnabledRef,
    autoplayRecoveryRequestIdRef,
    autoplayRouteTransitionRef,
    currentVideoId,
    currentVideoIdRef,
    hasActivePlaylistIntent,
    navigateToVideo,
    nextClearPlaylistRef,
    nextPlaylistIndexRef,
    nextVideoIdRef,
    pathname,
    pendingAutoAdvanceVideoIdRef,
    setEndedChoiceLoading,
    setPlayerClosedByEndOfVideo,
    setShowControls,
    setShowEndedChoiceOverlay,
    setShowShareMenu,
  ]);

  return {
    navigateToVideo,
    triggerEndOfVideoAction,
  };
}
