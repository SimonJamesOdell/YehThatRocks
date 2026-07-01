"use client";

import { useCallback, type MutableRefObject } from "react";

export function useDockedRouteNextTrackAction({
  isDockedNewRoute,
  isDockedTop100Route,
  footerActionsBlocked,
  routeAutoplayQueueIds,
  currentVideoId,
  showManualTransitionMask,
  hasUserGesturePlaybackUnlockRef,
  pendingAutoAdvanceVideoIdRef,
  navigateToVideo,
  activePlaylistId,
}: {
  isDockedNewRoute: boolean;
  isDockedTop100Route: boolean;
  footerActionsBlocked: boolean;
  routeAutoplayQueueIds: string[];
  currentVideoId: string;
  showManualTransitionMask: () => void;
  hasUserGesturePlaybackUnlockRef: MutableRefObject<boolean>;
  pendingAutoAdvanceVideoIdRef: MutableRefObject<string | null>;
  navigateToVideo: (
    videoId: string,
    options?: {
      clearPlaylist?: boolean;
      playlistId?: string | null;
      playlistItemIndex?: number | null;
      useNativeHistory?: boolean;
    },
  ) => void;
  activePlaylistId: string | null;
}) {
  const handleDockedRouteListNextTrack = useCallback(() => {
    if ((!isDockedNewRoute && !isDockedTop100Route) || footerActionsBlocked || routeAutoplayQueueIds.length === 0) {
      return;
    }

    const currentIndex = routeAutoplayQueueIds.findIndex((videoId) => videoId === currentVideoId);
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
      useNativeHistory: true,
    });
  }, [
    activePlaylistId,
    currentVideoId,
    footerActionsBlocked,
    hasUserGesturePlaybackUnlockRef,
    isDockedNewRoute,
    isDockedTop100Route,
    navigateToVideo,
    pendingAutoAdvanceVideoIdRef,
    routeAutoplayQueueIds,
    showManualTransitionMask,
  ]);

  return {
    handleDockedRouteListNextTrack,
  };
}
