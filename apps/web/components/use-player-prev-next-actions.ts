"use client";

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

type PlaylistStepTarget = {
  videoId: string;
  playlistItemIndex: number;
};

type NextTarget = {
  videoId: string;
  clearPlaylist: boolean;
  playlistItemIndex: number | null;
};

export function usePlayerPrevNextActions({
  activePlaylistId,
  resolvePlaylistStepTarget,
  showManualTransitionMask,
  hasUserGesturePlaybackUnlockRef,
  pendingAutoAdvanceVideoIdRef,
  navigateToVideo,
  historyStack,
  setHistoryStack,
  historyStorageKey,
  historyFallbackNavigate,
  resolveNextTarget,
  temporaryQueueVideoIds,
  currentVideoId,
  tempQueueDequeueEventName,
}: {
  activePlaylistId: string | null;
  resolvePlaylistStepTarget: (step: number) => PlaylistStepTarget | null;
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
  historyStack: string[];
  setHistoryStack: Dispatch<SetStateAction<string[]>>;
  historyStorageKey: string;
  historyFallbackNavigate: (videoId: string) => void;
  resolveNextTarget: () => NextTarget | null;
  temporaryQueueVideoIds: string[];
  currentVideoId: string;
  tempQueueDequeueEventName: string;
}) {
  const handlePrevious = useCallback(() => {
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

      return;
    }

    const previousId = historyStack.at(-2);
    if (!previousId) {
      return;
    }

    const trimmedHistory = historyStack.slice(0, -1);
    setHistoryStack(trimmedHistory);
    window.sessionStorage.setItem(historyStorageKey, JSON.stringify(trimmedHistory));
    showManualTransitionMask();
    hasUserGesturePlaybackUnlockRef.current = true;
    pendingAutoAdvanceVideoIdRef.current = previousId;
    historyFallbackNavigate(previousId);
  }, [
    activePlaylistId,
    hasUserGesturePlaybackUnlockRef,
    historyFallbackNavigate,
    historyStack,
    historyStorageKey,
    navigateToVideo,
    pendingAutoAdvanceVideoIdRef,
    resolvePlaylistStepTarget,
    setHistoryStack,
    showManualTransitionMask,
  ]);

  const handleNext = useCallback(() => {
    const nextTarget = resolveNextTarget();
    if (!nextTarget) {
      return;
    }

    const currentVideoWasQueued = temporaryQueueVideoIds.includes(currentVideoId);
    if (currentVideoWasQueued && nextTarget.videoId !== currentVideoId) {
      window.dispatchEvent(new CustomEvent(tempQueueDequeueEventName, {
        detail: {
          videoId: currentVideoId,
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
  }, [
    activePlaylistId,
    currentVideoId,
    hasUserGesturePlaybackUnlockRef,
    navigateToVideo,
    pendingAutoAdvanceVideoIdRef,
    resolveNextTarget,
    showManualTransitionMask,
    tempQueueDequeueEventName,
    temporaryQueueVideoIds,
  ]);

  return {
    handlePrevious,
    handleNext,
  };
}
