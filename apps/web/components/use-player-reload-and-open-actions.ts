"use client";

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

type ReloadablePlayer = {
  destroy?: () => void;
} | null;

export function usePlayerReloadAndOpenActions({
  playerRef,
  setIsPlayerReady,
  setIsPlaying,
  setHasPlaybackStarted,
  hasPlaybackStartedRef,
  setAllowDirectIframeInteraction,
  allowDirectIframeInteractionRef,
  clearUnavailableOverlayMessage,
  clearStuckPlaybackRetryTimer,
  clearStuckPlaybackWatchdogTimer,
  clearMidPlaybackBufferingCheck,
  clearPlayerLoadRefreshHintTimer,
  clearPlayerAutoReconnectTimer,
  setShowPlayerRefreshHint,
  clearBotBlockConfirmationTimer,
  clearManualTransitionMask,
  reportedUnavailableVideoIdRef,
  reportedUnavailableVerificationReasonRef,
  autoplaySuppressedVideoIdRef,
  playAttemptedAtRef,
  stuckPlaybackRetryCountRef,
  setPlayerReloadNonce,
  currentTrackYouTubeUrl,
}: {
  playerRef: MutableRefObject<ReloadablePlayer>;
  setIsPlayerReady: Dispatch<SetStateAction<boolean>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setHasPlaybackStarted: Dispatch<SetStateAction<boolean>>;
  hasPlaybackStartedRef: MutableRefObject<boolean>;
  setAllowDirectIframeInteraction: Dispatch<SetStateAction<boolean>>;
  allowDirectIframeInteractionRef: MutableRefObject<boolean>;
  clearUnavailableOverlayMessage: () => void;
  clearStuckPlaybackRetryTimer: () => void;
  clearStuckPlaybackWatchdogTimer: () => void;
  clearMidPlaybackBufferingCheck: () => void;
  clearPlayerLoadRefreshHintTimer: () => void;
  clearPlayerAutoReconnectTimer: () => void;
  setShowPlayerRefreshHint: Dispatch<SetStateAction<boolean>>;
  clearBotBlockConfirmationTimer: () => void;
  clearManualTransitionMask: () => void;
  reportedUnavailableVideoIdRef: MutableRefObject<string | null>;
  reportedUnavailableVerificationReasonRef: MutableRefObject<string | null>;
  autoplaySuppressedVideoIdRef: MutableRefObject<string | null>;
  playAttemptedAtRef: MutableRefObject<number | null>;
  stuckPlaybackRetryCountRef: MutableRefObject<number>;
  setPlayerReloadNonce: Dispatch<SetStateAction<number>>;
  currentTrackYouTubeUrl: string;
}) {
  const handleReloadPlayerIframe = useCallback(() => {
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
    allowDirectIframeInteractionRef.current = false;
    clearBotBlockConfirmationTimer();
    clearManualTransitionMask();
    reportedUnavailableVideoIdRef.current = null;
    reportedUnavailableVerificationReasonRef.current = null;
    autoplaySuppressedVideoIdRef.current = null;
    playAttemptedAtRef.current = null;
    stuckPlaybackRetryCountRef.current = 0;
    setPlayerReloadNonce((currentNonce) => currentNonce + 1);
  }, [
    allowDirectIframeInteractionRef,
    autoplaySuppressedVideoIdRef,
    clearBotBlockConfirmationTimer,
    clearManualTransitionMask,
    clearMidPlaybackBufferingCheck,
    clearPlayerAutoReconnectTimer,
    clearPlayerLoadRefreshHintTimer,
    clearStuckPlaybackRetryTimer,
    clearStuckPlaybackWatchdogTimer,
    clearUnavailableOverlayMessage,
    hasPlaybackStartedRef,
    playAttemptedAtRef,
    playerRef,
    reportedUnavailableVideoIdRef,
    reportedUnavailableVerificationReasonRef,
    setAllowDirectIframeInteraction,
    setHasPlaybackStarted,
    setIsPlaying,
    setIsPlayerReady,
    setPlayerReloadNonce,
    setShowPlayerRefreshHint,
    stuckPlaybackRetryCountRef,
  ]);

  const handleOpenCurrentTrackOnYouTube = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.open(currentTrackYouTubeUrl, "_blank", "noopener,noreferrer");
  }, [currentTrackYouTubeUrl]);

  return {
    handleReloadPlayerIframe,
    handleOpenCurrentTrackOnYouTube,
  };
}
