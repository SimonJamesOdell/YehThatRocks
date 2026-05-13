"use client";

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

type PlaybackPlayer = {
  pauseVideo?: () => void;
} | null;

export function usePlayerPlaybackRuntimeControls({
  playerRef,
  progressIntervalRef,
  setIsPlaying,
  setCurrentTime,
  playbackStallStartedAtRef,
  playbackStallLastTimeRef,
  playbackStallLastObservedAtRef,
  manualTransitionMaskTimeoutRef,
  setIsManualTransitionMaskVisible,
  stuckPlaybackRetryTimeoutRef,
  stuckPlaybackWatchdogTimeoutRef,
  earlyPlaybackVerificationTimeoutRef,
  midPlaybackBufferingCheckTimeoutRef,
  midPlaybackBufferingStartedAtRef,
  playerLoadRefreshHintTimeoutRef,
  playerAutoReconnectTimeoutRef,
  manualTransitionMaskTimeoutMs,
}: {
  playerRef: MutableRefObject<PlaybackPlayer>;
  progressIntervalRef: MutableRefObject<ReturnType<typeof setInterval> | null>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setCurrentTime: Dispatch<SetStateAction<number>>;
  playbackStallStartedAtRef: MutableRefObject<number | null>;
  playbackStallLastTimeRef: MutableRefObject<number | null>;
  playbackStallLastObservedAtRef: MutableRefObject<number | null>;
  manualTransitionMaskTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setIsManualTransitionMaskVisible: Dispatch<SetStateAction<boolean>>;
  stuckPlaybackRetryTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  stuckPlaybackWatchdogTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  earlyPlaybackVerificationTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  midPlaybackBufferingCheckTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  midPlaybackBufferingStartedAtRef: MutableRefObject<number | null>;
  playerLoadRefreshHintTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  playerAutoReconnectTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  manualTransitionMaskTimeoutMs: number;
}) {
  const resetPlaybackStallWatchdog = useCallback((lastTime?: number | null) => {
    playbackStallStartedAtRef.current = null;
    playbackStallLastTimeRef.current = typeof lastTime === "number" ? lastTime : null;
    playbackStallLastObservedAtRef.current = Date.now();
  }, [playbackStallLastObservedAtRef, playbackStallLastTimeRef, playbackStallStartedAtRef]);

  const pauseActivePlayback = useCallback(() => {
    if (progressIntervalRef.current) {
      window.clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }

    const runtimePlayer = playerRef.current;

    if (runtimePlayer && typeof runtimePlayer.pauseVideo === "function") {
      runtimePlayer.pauseVideo();
    }

    setIsPlaying(false);
  }, [playerRef, progressIntervalRef, setIsPlaying]);

  const showManualTransitionMask = useCallback(() => {
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
    }, manualTransitionMaskTimeoutMs);
  }, [manualTransitionMaskTimeoutMs, manualTransitionMaskTimeoutRef, pauseActivePlayback, setCurrentTime, setIsManualTransitionMaskVisible]);

  const clearStuckPlaybackRetryTimer = useCallback(() => {
    if (stuckPlaybackRetryTimeoutRef.current !== null) {
      window.clearTimeout(stuckPlaybackRetryTimeoutRef.current);
      stuckPlaybackRetryTimeoutRef.current = null;
    }
  }, [stuckPlaybackRetryTimeoutRef]);

  const clearStuckPlaybackWatchdogTimer = useCallback(() => {
    if (stuckPlaybackWatchdogTimeoutRef.current !== null) {
      window.clearTimeout(stuckPlaybackWatchdogTimeoutRef.current);
      stuckPlaybackWatchdogTimeoutRef.current = null;
    }
  }, [stuckPlaybackWatchdogTimeoutRef]);

  const clearEarlyPlaybackVerificationTimer = useCallback(() => {
    if (earlyPlaybackVerificationTimeoutRef.current !== null) {
      window.clearTimeout(earlyPlaybackVerificationTimeoutRef.current);
      earlyPlaybackVerificationTimeoutRef.current = null;
    }
  }, [earlyPlaybackVerificationTimeoutRef]);

  const clearMidPlaybackBufferingCheck = useCallback(() => {
    if (midPlaybackBufferingCheckTimeoutRef.current !== null) {
      window.clearTimeout(midPlaybackBufferingCheckTimeoutRef.current);
      midPlaybackBufferingCheckTimeoutRef.current = null;
    }
    midPlaybackBufferingStartedAtRef.current = null;
  }, [midPlaybackBufferingCheckTimeoutRef, midPlaybackBufferingStartedAtRef]);

  const clearPlayerLoadRefreshHintTimer = useCallback(() => {
    if (playerLoadRefreshHintTimeoutRef.current !== null) {
      window.clearTimeout(playerLoadRefreshHintTimeoutRef.current);
      playerLoadRefreshHintTimeoutRef.current = null;
    }
  }, [playerLoadRefreshHintTimeoutRef]);

  const clearPlayerAutoReconnectTimer = useCallback(() => {
    if (playerAutoReconnectTimeoutRef.current !== null) {
      window.clearTimeout(playerAutoReconnectTimeoutRef.current);
      playerAutoReconnectTimeoutRef.current = null;
    }
  }, [playerAutoReconnectTimeoutRef]);

  return {
    resetPlaybackStallWatchdog,
    pauseActivePlayback,
    showManualTransitionMask,
    clearStuckPlaybackRetryTimer,
    clearStuckPlaybackWatchdogTimer,
    clearEarlyPlaybackVerificationTimer,
    clearMidPlaybackBufferingCheck,
    clearPlayerLoadRefreshHintTimer,
    clearPlayerAutoReconnectTimer,
  };
}
