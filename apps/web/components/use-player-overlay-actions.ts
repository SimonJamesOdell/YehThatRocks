"use client";

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { RESUME_KEY } from "@/lib/storage-keys";

export function usePlayerOverlayActions({
  currentVideoId,
  playerRef,
  currentTime,
  overlayTimeoutRef,
  unavailableOverlayTimeoutRef,
  unavailableAutoActionTimeoutRef,
  unavailableAutoCountdownIntervalRef,
  manualTransitionMaskTimeoutRef,
  botBlockConfirmationTimeoutRef,
  setShowNowPlayingOverlay,
  setOverlayInstance,
  setUnavailableOverlayMessage,
  setUnavailableOverlayKind,
  setUnavailableOverlayRequiresOk,
  setUnavailableAutoAdvanceMs,
  setUnavailableAutoAdvanceSeconds,
  setIsManualTransitionMaskVisible,
  setIsBotBlockConfirmationPending,
  setPlayerClosedByEndOfVideo,
  setEndedChoiceLoading,
  setShowEndedChoiceOverlay,
  setShowControls,
  setShowShareMenu,
  setShowPlayerRefreshHint,
}: {
  currentVideoId: string;
  playerRef: MutableRefObject<{ getCurrentTime?: () => number; pauseVideo?: () => void; getPlayerState?: () => number; destroy?: () => void } | null>;
  currentTime: number;
  overlayTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  unavailableOverlayTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  unavailableAutoActionTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  unavailableAutoCountdownIntervalRef: MutableRefObject<ReturnType<typeof setInterval> | null>;
  manualTransitionMaskTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  botBlockConfirmationTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setShowNowPlayingOverlay: Dispatch<SetStateAction<boolean>>;
  setOverlayInstance: Dispatch<SetStateAction<number>>;
  setUnavailableOverlayMessage: Dispatch<SetStateAction<string | null>>;
  setUnavailableOverlayKind: Dispatch<SetStateAction<string>>;
  setUnavailableOverlayRequiresOk: Dispatch<SetStateAction<boolean>>;
  setUnavailableAutoAdvanceMs: Dispatch<SetStateAction<number | null>>;
  setUnavailableAutoAdvanceSeconds: Dispatch<SetStateAction<number | null>>;
  setIsManualTransitionMaskVisible: Dispatch<SetStateAction<boolean>>;
  setIsBotBlockConfirmationPending: Dispatch<SetStateAction<boolean>>;
  setPlayerClosedByEndOfVideo: Dispatch<SetStateAction<boolean>>;
  setEndedChoiceLoading: Dispatch<SetStateAction<boolean>>;
  setShowEndedChoiceOverlay: Dispatch<SetStateAction<boolean>>;
  setShowControls: Dispatch<SetStateAction<boolean>>;
  setShowShareMenu: Dispatch<SetStateAction<boolean>>;
  setShowPlayerRefreshHint: Dispatch<SetStateAction<boolean>>;
}) {
  const persistResumeSnapshot = useCallback((wasPlaying: boolean, explicitTime?: number) => {
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
        videoId: currentVideoId,
        wasPlaying,
      }),
    );
  }, [currentTime, currentVideoId, playerRef]);

  const triggerNowPlayingOverlay = useCallback(() => {
    if (overlayTimeoutRef.current) {
      window.clearTimeout(overlayTimeoutRef.current);
    }

    setOverlayInstance((value) => value + 1);
    setShowNowPlayingOverlay(true);

    overlayTimeoutRef.current = window.setTimeout(() => {
      setShowNowPlayingOverlay(false);
    }, 3200);
  }, [overlayTimeoutRef, setOverlayInstance, setShowNowPlayingOverlay]);

  const clearUnavailableOverlayMessage = useCallback(() => {
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
  }, [setUnavailableAutoAdvanceMs, setUnavailableAutoAdvanceSeconds, setUnavailableOverlayKind, setUnavailableOverlayMessage, setUnavailableOverlayRequiresOk, unavailableAutoActionTimeoutRef, unavailableAutoCountdownIntervalRef, unavailableOverlayTimeoutRef]);

  const clearManualTransitionMask = useCallback(() => {
    if (manualTransitionMaskTimeoutRef.current !== null) {
      window.clearTimeout(manualTransitionMaskTimeoutRef.current);
      manualTransitionMaskTimeoutRef.current = null;
    }

    setIsManualTransitionMaskVisible(false);
  }, [manualTransitionMaskTimeoutRef, setIsManualTransitionMaskVisible]);

  const clearBotBlockConfirmationTimer = useCallback((options?: { clearPendingState?: boolean }) => {
    if (botBlockConfirmationTimeoutRef.current !== null) {
      window.clearTimeout(botBlockConfirmationTimeoutRef.current);
      botBlockConfirmationTimeoutRef.current = null;
    }

    if (options?.clearPendingState !== false) {
      setIsBotBlockConfirmationPending(false);
    }
  }, [botBlockConfirmationTimeoutRef, setIsBotBlockConfirmationPending]);

  const acknowledgeDeletedOverlay = useCallback(() => {
    clearUnavailableOverlayMessage();
    setPlayerClosedByEndOfVideo(false);
    setShowEndedChoiceOverlay(false);
  }, [clearUnavailableOverlayMessage, setPlayerClosedByEndOfVideo, setShowEndedChoiceOverlay]);

  const acknowledgeUnavailableOverlay = useCallback(() => {
    clearUnavailableOverlayMessage();
    setShowControls(true);
    setShowShareMenu(false);
    setShowPlayerRefreshHint(false);
  }, [clearUnavailableOverlayMessage, setShowControls, setShowPlayerRefreshHint, setShowShareMenu]);

  const showUnavailableOverlayMessage = useCallback((message: string, options?: { requiresOk?: boolean; autoAdvanceWhenAutoplay?: boolean; countdownMs?: number }) => {
    clearUnavailableOverlayMessage();
    setShowNowPlayingOverlay(false);
    setUnavailableOverlayMessage(message);
    setUnavailableOverlayKind("playback");
    setUnavailableOverlayRequiresOk(Boolean(options?.requiresOk));
    setUnavailableAutoAdvanceMs(options?.countdownMs ?? null);
    setUnavailableAutoAdvanceSeconds(options?.countdownMs != null ? Math.max(1, Math.ceil(options.countdownMs / 1000)) : null);
  }, [clearUnavailableOverlayMessage, setShowNowPlayingOverlay, setUnavailableAutoAdvanceMs, setUnavailableAutoAdvanceSeconds, setUnavailableOverlayKind, setUnavailableOverlayMessage, setUnavailableOverlayRequiresOk]);

  const showDeletedOverlayConfirmation = useCallback(() => {
    clearUnavailableOverlayMessage();
    setEndedChoiceLoading(false);
    setPlayerClosedByEndOfVideo(true);
    setShowEndedChoiceOverlay(true);
  }, [clearUnavailableOverlayMessage, setEndedChoiceLoading, setPlayerClosedByEndOfVideo, setShowEndedChoiceOverlay]);

  return {
    persistResumeSnapshot,
    triggerNowPlayingOverlay,
    clearUnavailableOverlayMessage,
    clearManualTransitionMask,
    clearBotBlockConfirmationTimer,
    acknowledgeDeletedOverlay,
    acknowledgeUnavailableOverlay,
    showUnavailableOverlayMessage,
    showDeletedOverlayConfirmation,
  };
}
