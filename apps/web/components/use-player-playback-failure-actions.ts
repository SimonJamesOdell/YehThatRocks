"use client";

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { resolveVerifiedPlaybackFailurePresentation, type ReportUnavailableResult } from "@/components/player-experience-playback-failure-utils";

const UPSTREAM_CONNECTIVITY_OVERLAY_MESSAGE = "Playback is taking too long to connect. Trying a different track...";
const COPYRIGHT_CLAIM_OVERLAY_MESSAGE = "This track is unavailable because of a copyright claim.";
const REMOVED_PRIVATE_OVERLAY_MESSAGE = "This track is no longer available.";
const BOT_BLOCK_CONFIRMATION_DELAY_MS = 3_500;

type RuntimePlayer = {
  getVideoData?: () => { video_id?: string | null };
  getPlayerState?: () => number;
  getCurrentTime?: () => number;
  getDuration?: () => number;
  isMuted?: () => boolean;
};

export function usePlayerPlaybackFailureActions({
  currentVideoId,
  currentVideoRef,
  playerRef,
  toSafeNumber,
  isMutedRef,
  hasPlaybackStartedRef,
  setIsPlayerReady,
  setShowPlayerRefreshHint,
  setIsPlaying,
  setHasPlaybackStarted,
  setCurrentTime,
  setDuration,
  setIsMuted,
  resetPlaybackStallWatchdog,
  clearManualTransitionMask,
  clearBotBlockConfirmationTimer,
  setAllowDirectIframeInteraction,
  allowDirectIframeInteractionRef,
  setIsBotBlockConfirmationPending,
  botBlockConfirmationTimeoutRef,
  overlayTimeoutRef,
  unavailableAutoActionTimeoutRef,
  clearUnavailableOverlayMessage,
  setShowNowPlayingOverlay,
  setShowControls,
  setShowShareMenu,
  showUnavailableOverlayMessage,
  playbackStallStartedAtRef,
  playbackStallLastTimeRef,
  playbackStallLastObservedAtRef,
  autoplaySuppressedVideoIdRef,
  playAttemptedAtRef,
  pauseActivePlayback,
  navigateToVideo,
  logPlayerDebug,
  switchPlayerVideo,
  reportUnavailableFromPlayer,
}: {
  currentVideoId: string;
  currentVideoRef: MutableRefObject<{ id: string }>;
  playerRef: MutableRefObject<RuntimePlayer | null>;
  toSafeNumber: (value: unknown, fallback?: number) => number;
  isMutedRef: MutableRefObject<boolean>;
  hasPlaybackStartedRef: MutableRefObject<boolean>;
  setIsPlayerReady: Dispatch<SetStateAction<boolean>>;
  setShowPlayerRefreshHint: Dispatch<SetStateAction<boolean>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setHasPlaybackStarted: Dispatch<SetStateAction<boolean>>;
  setCurrentTime: Dispatch<SetStateAction<number>>;
  setDuration: Dispatch<SetStateAction<number>>;
  setIsMuted: Dispatch<SetStateAction<boolean>>;
  resetPlaybackStallWatchdog: (lastTime?: number | null) => void;
  clearManualTransitionMask: () => void;
  clearBotBlockConfirmationTimer: (options?: { clearPendingState?: boolean }) => void;
  setAllowDirectIframeInteraction: Dispatch<SetStateAction<boolean>>;
  allowDirectIframeInteractionRef: MutableRefObject<boolean>;
  setIsBotBlockConfirmationPending: Dispatch<SetStateAction<boolean>>;
  botBlockConfirmationTimeoutRef: MutableRefObject<number | null>;
  overlayTimeoutRef: MutableRefObject<number | null>;
  unavailableAutoActionTimeoutRef: MutableRefObject<number | null>;
  clearUnavailableOverlayMessage: () => void;
  setShowNowPlayingOverlay: Dispatch<SetStateAction<boolean>>;
  setShowControls: Dispatch<SetStateAction<boolean>>;
  setShowShareMenu: Dispatch<SetStateAction<boolean>>;
  playbackStallStartedAtRef: MutableRefObject<number | null>;
  playbackStallLastTimeRef: MutableRefObject<number | null>;
  playbackStallLastObservedAtRef: MutableRefObject<number | null>;
  autoplaySuppressedVideoIdRef: MutableRefObject<string | null>;
  playAttemptedAtRef: MutableRefObject<number | null>;
  pauseActivePlayback: () => void;
  showUnavailableOverlayMessage: (message: string, options?: { requiresOk?: boolean; autoAdvanceWhenAutoplay?: boolean; countdownMs?: number }) => void;
  navigateToVideo: (videoId: string, options?: { clearPlaylist?: boolean; playlistId?: string | null; playlistItemIndex?: number | null; useNativeHistory?: boolean }) => void;
  logPlayerDebug: (event: string, detail?: Record<string, unknown>) => void;
  switchPlayerVideo: (player: { getPlayerState?: () => number } & RuntimePlayer, videoId: string) => boolean;
  reportUnavailableFromPlayer: (reason: string) => Promise<ReportUnavailableResult>;
}) {
  const hasActivePlaybackForCurrentVideo = useCallback(() => {
    const runtimePlayer = playerRef.current;
    if (!runtimePlayer) {
      return false;
    }

    const state = typeof runtimePlayer.getPlayerState === "function" ? runtimePlayer.getPlayerState() : -1;
    if (state === window.YT?.PlayerState.PLAYING) {
      return true;
    }

    const currentTime = typeof runtimePlayer.getCurrentTime === "function" ? toSafeNumber(runtimePlayer.getCurrentTime(), 0) : 0;
    return currentTime > 1;
  }, [playerRef, toSafeNumber]);

  const restoreVisiblePlaybackStateFromRuntime = useCallback((reason: string) => {
    const runtimePlayer = playerRef.current;
    if (!runtimePlayer) {
      return;
    }

    const runtimeVideoId = typeof runtimePlayer.getVideoData === "function"
      ? (runtimePlayer.getVideoData()?.video_id ?? null)
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

    clearManualTransitionMask();
    clearBotBlockConfirmationTimer();

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
  }, [clearBotBlockConfirmationTimer, clearManualTransitionMask, currentVideoRef, hasPlaybackStartedRef, isMutedRef, logPlayerDebug, playerRef, resetPlaybackStallWatchdog, setCurrentTime, setDuration, setHasPlaybackStarted, setIsMuted, setIsPlayerReady, setIsPlaying, setShowPlayerRefreshHint, toSafeNumber]);

  const enableDirectIframeInteractionMode = useCallback((trigger: string, verificationReason: string | null) => {
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

    if (unavailableAutoActionTimeoutRef.current !== null) {
      logPlayerDebug("bot-challenge:direct-iframe-mode-suppressed-unavailable-countdown", {
        videoId: currentVideoRef.current.id,
        trigger,
        verificationReason,
      });
      return;
    }

    clearBotBlockConfirmationTimer();
    setAllowDirectIframeInteraction(false);
    allowDirectIframeInteractionRef.current = false;
    setIsBotBlockConfirmationPending(true);

    const targetVideoId = currentVideoRef.current.id;
    botBlockConfirmationTimeoutRef.current = window.setTimeout(() => {
      botBlockConfirmationTimeoutRef.current = null;

      if (currentVideoRef.current.id !== targetVideoId) {
        setIsBotBlockConfirmationPending(false);
        return;
      }

      if (hasActivePlaybackForCurrentVideo()) {
        setIsBotBlockConfirmationPending(false);
        restoreVisiblePlaybackStateFromRuntime("direct-iframe-confirmation-cancelled-active-playback");
        logPlayerDebug("bot-challenge:direct-iframe-mode-cancelled-active-playback", {
          videoId: currentVideoRef.current.id,
          trigger,
          verificationReason,
        });
        return;
      }

      setIsBotBlockConfirmationPending(false);

      if (overlayTimeoutRef.current) {
        window.clearTimeout(overlayTimeoutRef.current);
        overlayTimeoutRef.current = null;
      }

      clearUnavailableOverlayMessage();
      clearManualTransitionMask();
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
        confirmationDelayMs: BOT_BLOCK_CONFIRMATION_DELAY_MS,
      });
    }, BOT_BLOCK_CONFIRMATION_DELAY_MS);
  }, [allowDirectIframeInteractionRef, botBlockConfirmationTimeoutRef, clearBotBlockConfirmationTimer, clearManualTransitionMask, clearUnavailableOverlayMessage, currentVideoRef, hasActivePlaybackForCurrentVideo, logPlayerDebug, overlayTimeoutRef, playbackStallLastObservedAtRef, playbackStallStartedAtRef, playbackStallLastTimeRef, restoreVisiblePlaybackStateFromRuntime, setAllowDirectIframeInteraction, setIsBotBlockConfirmationPending, setShowControls, setShowNowPlayingOverlay, setShowPlayerRefreshHint, setShowShareMenu, unavailableAutoActionTimeoutRef]);

  const applyVerifiedPlaybackFailurePresentation = useCallback((
    trigger: string,
    runtimeReason: string,
    reportResult: ReportUnavailableResult,
    options?: { unavailableMessage?: string; unavailableCountdownMs?: number },
  ) => {
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
      enableDirectIframeInteractionMode(trigger, reportResult.verificationReason);
      return;
    }

    autoplaySuppressedVideoIdRef.current = currentVideoId;
    playAttemptedAtRef.current = null;
    pauseActivePlayback();
    showUnavailableOverlayMessage(presentation.message ?? UPSTREAM_CONNECTIVITY_OVERLAY_MESSAGE, {
      requiresOk: presentation.requiresOk,
      autoAdvanceWhenAutoplay: presentation.autoAdvanceWhenAutoplay,
      countdownMs: presentation.countdownMs,
    });
  }, [autoplaySuppressedVideoIdRef, currentVideoId, currentVideoRef, enableDirectIframeInteractionMode, logPlayerDebug, pauseActivePlayback, playAttemptedAtRef, showUnavailableOverlayMessage]);

  const navigateToReplacementVideoIfFound = useCallback((
    trigger: string,
    reportedVideoId: string,
    reportResult: ReportUnavailableResult,
  ) => {
    if (!reportResult.newVideoId || currentVideoRef.current.id !== reportedVideoId) {
      return false;
    }

    logPlayerDebug("playback-failure:replacement-found", {
      trigger,
      reportedVideoId,
      replacementVideoId: reportResult.newVideoId,
      verificationReason: reportResult.verificationReason,
      classification: reportResult.classification,
    });

    clearUnavailableOverlayMessage();
    navigateToVideo(reportResult.newVideoId, { clearPlaylist: false });
    return true;
  }, [clearUnavailableOverlayMessage, currentVideoRef, logPlayerDebug, navigateToVideo]);

  return {
    hasActivePlaybackForCurrentVideo,
    restoreVisiblePlaybackStateFromRuntime,
    enableDirectIframeInteractionMode,
    applyVerifiedPlaybackFailurePresentation,
    navigateToReplacementVideoIfFound,
  };
}
