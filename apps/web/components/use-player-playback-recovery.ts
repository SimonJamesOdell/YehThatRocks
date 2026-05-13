"use client";

import { useCallback, type MutableRefObject } from "react";

import { applyVerifiedPlaybackFailurePresentation, isInteractivePlaybackBlockReason, type ReportUnavailableResult } from "@/components/player-experience-playback-failure-utils";

const EARLY_PLAYBACK_VERIFICATION_MS = 8_000;
const MID_PLAYBACK_BUFFERING_CHECK_MS = 3_000;
const MID_PLAYBACK_BUFFERING_THRESHOLD_MS = 30_000;
const STUCK_PLAYBACK_CHECK_MS = 12_000;
const STUCK_PLAYBACK_MAX_RETRIES = 2;
const STUCK_PLAYBACK_RETRY_DELAYS_MS = [2_500, 5_000, 10_000] as const;
const UPSTREAM_CONNECTIVITY_OVERLAY_MESSAGE = "Playback is taking too long to connect. Trying a different track...";

type MaybePlayer = {
  getPlayerState?: () => number;
  getDuration?: () => number;
  getCurrentTime?: () => number;
  playVideo?: () => void;
} | null;

export function usePlayerPlaybackRecovery({
  currentVideoIdRef,
  playerRef,
  playAttemptedAtRef,
  hasUserGesturePlaybackUnlockRef,
  clearEarlyPlaybackVerificationTimer,
  clearStuckPlaybackRetryTimer,
  clearStuckPlaybackWatchdogTimer,
  clearMidPlaybackBufferingCheck,
  stuckPlaybackRetryCountRef,
  stuckPlaybackWatchdogTimeoutRef,
  earlyPlaybackVerificationTimeoutRef,
  midPlaybackBufferingCheckTimeoutRef,
  midPlaybackBufferingStartedAtRef,
  autoplaySuppressedVideoIdRef,
  playerHostMode,
  logPlayerDebug,
  toSafeNumber,
  reportUnavailableFromPlayer,
  navigateToReplacementVideoIfFound,
  showUnavailableOverlayMessage,
  switchPlayerVideo,
  applyPlaybackFailurePresentation,
}: {
  currentVideoIdRef: MutableRefObject<string>;
  playerRef: MutableRefObject<MaybePlayer>;
  playAttemptedAtRef: MutableRefObject<number | null>;
  hasUserGesturePlaybackUnlockRef: MutableRefObject<boolean>;
  clearEarlyPlaybackVerificationTimer: () => void;
  clearStuckPlaybackRetryTimer: () => void;
  clearStuckPlaybackWatchdogTimer: () => void;
  clearMidPlaybackBufferingCheck: () => void;
  stuckPlaybackRetryCountRef: MutableRefObject<number>;
  stuckPlaybackWatchdogTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  earlyPlaybackVerificationTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  midPlaybackBufferingCheckTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  midPlaybackBufferingStartedAtRef: MutableRefObject<number | null>;
  autoplaySuppressedVideoIdRef: MutableRefObject<string | null>;
  playerHostMode: string;
  logPlayerDebug: (event: string, detail?: Record<string, unknown>) => void;
  toSafeNumber: (value: unknown, fallback?: number) => number;
  reportUnavailableFromPlayer: (reason: string) => Promise<ReportUnavailableResult>;
  navigateToReplacementVideoIfFound: (stage: string, targetVideoId: string, reportResult: ReportUnavailableResult) => boolean;
  showUnavailableOverlayMessage: (message: string) => void;
  switchPlayerVideo: (player: NonNullable<MaybePlayer>, videoId: string) => boolean;
  applyPlaybackFailurePresentation: (stage: string, reason: string, reportResult: ReportUnavailableResult) => void;
}) {
  const canProgrammaticPlaybackStart = useCallback(() => {
    return hasUserGesturePlaybackUnlockRef.current;
  }, [hasUserGesturePlaybackUnlockRef]);

  const shouldSuppressAutoplayForInitialPageLoad = useCallback((videoId: string) => {
    if (typeof window === "undefined") {
      return false;
    }

    if (window.__ytrInitialPageLoadAutoplaySuppressed) {
      return false;
    }

    if (window.__ytrInitialPageLoadVideoId === undefined) {
      window.__ytrInitialPageLoadVideoId = currentVideoIdRef.current;
    }

    const initialPageLoadVideoId = window.__ytrInitialPageLoadVideoId;
    const shouldSuppress = Boolean(initialPageLoadVideoId && videoId === initialPageLoadVideoId);

    if (!shouldSuppress) {
      return false;
    }

    window.__ytrInitialPageLoadAutoplaySuppressed = true;
    return true;
  }, [currentVideoIdRef]);

  const scheduleStuckPlaybackRetry = useCallback((trigger: string) => {
    const attempt = stuckPlaybackRetryCountRef.current;

    if (attempt >= STUCK_PLAYBACK_MAX_RETRIES) {
      return false;
    }

    const targetVideoId = currentVideoIdRef.current;
    const delayMs = STUCK_PLAYBACK_RETRY_DELAYS_MS[Math.min(attempt, STUCK_PLAYBACK_RETRY_DELAYS_MS.length - 1)];
    const nextAttempt = attempt + 1;

    stuckPlaybackRetryCountRef.current = nextAttempt;
    clearStuckPlaybackRetryTimer();

    logPlayerDebug("stuck-playback:retry-scheduled", {
      videoId: targetVideoId,
      trigger,
      attempt: nextAttempt,
      delayMs,
      playerHostMode,
    });

    stuckPlaybackRetryTimeoutRef.current = window.setTimeout(() => {
      stuckPlaybackRetryTimeoutRef.current = null;

      if (currentVideoIdRef.current !== targetVideoId) {
        return;
      }

      const runtimePlayer = playerRef.current;
      if (!runtimePlayer) {
        return;
      }

      const didSwitch = switchPlayerVideo(runtimePlayer, targetVideoId);
      if (!didSwitch) {
        return;
      }

      if (!canProgrammaticPlaybackStart()) {
        logPlayerDebug("stuck-playback:retry-skipped-until-user-gesture", {
          videoId: targetVideoId,
          trigger,
          attempt: nextAttempt,
        });
        return;
      }

      notePlayAttempt();
      runtimePlayer.playVideo?.();

      logPlayerDebug("stuck-playback:retry-fired", {
        videoId: targetVideoId,
        trigger,
        attempt: nextAttempt,
      });
    }, delayMs);

    return true;
  }, [canProgrammaticPlaybackStart, clearStuckPlaybackRetryTimer, currentVideoIdRef, logPlayerDebug, playerHostMode, playerRef, stuckPlaybackRetryCountRef, stuckPlaybackRetryTimeoutRef, switchPlayerVideo]);

  const scheduleStuckPlaybackWatchdog = useCallback((trigger: string) => {
    clearStuckPlaybackWatchdogTimer();

    const targetVideoId = currentVideoIdRef.current;

    stuckPlaybackWatchdogTimeoutRef.current = window.setTimeout(() => {
      stuckPlaybackWatchdogTimeoutRef.current = null;

      void (async () => {
        if (currentVideoIdRef.current !== targetVideoId) {
          return;
        }

        const player = playerRef.current;
        const attemptedAt = playAttemptedAtRef.current;

        if (!player || !attemptedAt) {
          return;
        }

        const state = typeof player.getPlayerState === "function" ? player.getPlayerState() : -1;
        const durationValue = typeof player.getDuration === "function" ? toSafeNumber(player.getDuration(), 0) : 0;
        const currentPosition = typeof player.getCurrentTime === "function" ? toSafeNumber(player.getCurrentTime(), 0) : 0;
        const stillBlocked =
          state !== window.YT?.PlayerState.PLAYING
          && (durationValue <= 0 || currentPosition < 1.5);

        if (!stillBlocked) {
          return;
        }

        const scheduledRetry = scheduleStuckPlaybackRetry("runtime-stuck-loading");

        if (scheduledRetry) {
          logPlayerDebug("runtime-block-check:retry-scheduled", {
            videoId: currentVideoIdRef.current,
            playerHostMode,
            durationValue,
            currentPosition,
            state,
            retryAttempt: stuckPlaybackRetryCountRef.current,
            trigger,
          });
          return;
        }

        const reportResult = await reportUnavailableFromPlayer("yt-player-upstream-connect-timeout");
        logPlayerDebug("runtime-block-check", {
          videoId: currentVideoIdRef.current,
          playerHostMode,
          shouldSkip: reportResult.shouldSkip,
          verificationReason: reportResult.verificationReason,
          botChallengeDetected: isInteractivePlaybackBlockReason(reportResult.verificationReason),
          durationValue,
          currentPosition,
          state,
          retryAttempt: stuckPlaybackRetryCountRef.current,
          trigger,
        });

        if (navigateToReplacementVideoIfFound("runtime-block-check", targetVideoId, reportResult)) {
          return;
        }

        applyPlaybackFailurePresentation("runtime-block-check", "yt-player-upstream-connect-timeout", reportResult);
      })();
    }, STUCK_PLAYBACK_CHECK_MS);
  }, [applyPlaybackFailurePresentation, clearStuckPlaybackWatchdogTimer, currentVideoIdRef, logPlayerDebug, navigateToReplacementVideoIfFound, playerHostMode, playerRef, playAttemptedAtRef, reportUnavailableFromPlayer, scheduleStuckPlaybackRetry, stuckPlaybackRetryCountRef, stuckPlaybackWatchdogTimeoutRef, toSafeNumber]);

  const notePlayAttempt = useCallback(() => {
    playAttemptedAtRef.current = Date.now();
    clearEarlyPlaybackVerificationTimer();

    const targetVideoId = currentVideoIdRef.current;
    earlyPlaybackVerificationTimeoutRef.current = window.setTimeout(() => {
      earlyPlaybackVerificationTimeoutRef.current = null;

      void (async () => {
        if (currentVideoIdRef.current !== targetVideoId) {
          return;
        }

        const player = playerRef.current;
        if (!player || !playAttemptedAtRef.current) {
          return;
        }

        const state = typeof player.getPlayerState === "function" ? player.getPlayerState() : -1;
        const durationValue = typeof player.getDuration === "function" ? toSafeNumber(player.getDuration(), 0) : 0;
        const currentPosition = typeof player.getCurrentTime === "function" ? toSafeNumber(player.getCurrentTime(), 0) : 0;
        const stillUnstarted =
          state !== window.YT?.PlayerState.PLAYING
          && (durationValue <= 0 || currentPosition < 0.25);

        if (!stillUnstarted) {
          return;
        }

        const runtimeReason = "yt-player-early-refusal-check";
        const reportResult = await reportUnavailableFromPlayer(runtimeReason);

        logPlayerDebug("early-playback-verification", {
          videoId: currentVideoIdRef.current,
          playerHostMode,
          verificationReason: reportResult.verificationReason,
          botChallengeDetected: isInteractivePlaybackBlockReason(reportResult.verificationReason),
          durationValue,
          currentPosition,
          state,
        });

        if (navigateToReplacementVideoIfFound("early-playback-verification", targetVideoId, reportResult)) {
          return;
        }

        applyPlaybackFailurePresentation("early-playback-verification", runtimeReason, reportResult);
      })();
    }, EARLY_PLAYBACK_VERIFICATION_MS);

    scheduleStuckPlaybackWatchdog("play-attempt");
  }, [applyPlaybackFailurePresentation, clearEarlyPlaybackVerificationTimer, currentVideoIdRef, earlyPlaybackVerificationTimeoutRef, logPlayerDebug, navigateToReplacementVideoIfFound, playerHostMode, playerRef, playAttemptedAtRef, reportUnavailableFromPlayer, scheduleStuckPlaybackWatchdog, toSafeNumber]);

  const scheduleMidPlaybackBufferingCheck = useCallback((trigger: string) => {
    clearMidPlaybackBufferingCheck();

    const targetVideoId = currentVideoIdRef.current;
    midPlaybackBufferingStartedAtRef.current = null;

    midPlaybackBufferingCheckTimeoutRef.current = window.setTimeout(() => {
      midPlaybackBufferingCheckTimeoutRef.current = null;

      if (currentVideoIdRef.current !== targetVideoId) {
        return;
      }

      const player = playerRef.current;
      if (!player) {
        return;
      }

      const state = typeof player.getPlayerState === "function" ? player.getPlayerState() : -1;
      const bufferingState = 3;
      const isBuffering = state === bufferingState;

      if (!isBuffering) {
        midPlaybackBufferingStartedAtRef.current = null;
        return;
      }

      if (midPlaybackBufferingStartedAtRef.current === null) {
        midPlaybackBufferingStartedAtRef.current = Date.now();
      }

      const bufferingDurationMs = Date.now() - midPlaybackBufferingStartedAtRef.current;

      if (bufferingDurationMs >= MID_PLAYBACK_BUFFERING_THRESHOLD_MS) {
        logPlayerDebug("mid-playback:buffering-timeout", {
          videoId: targetVideoId,
          bufferingDurationMs,
          playerHostMode,
        });

        autoplaySuppressedVideoIdRef.current = targetVideoId;
        showUnavailableOverlayMessage(UPSTREAM_CONNECTIVITY_OVERLAY_MESSAGE);
        return;
      }

      logPlayerDebug("mid-playback:buffering-check", {
        videoId: targetVideoId,
        bufferingDurationMs,
        trigger,
        playerHostMode,
      });

      scheduleMidPlaybackBufferingCheck("recurring");
    }, MID_PLAYBACK_BUFFERING_CHECK_MS);
  }, [autoplaySuppressedVideoIdRef, clearMidPlaybackBufferingCheck, currentVideoIdRef, logPlayerDebug, midPlaybackBufferingCheckTimeoutRef, midPlaybackBufferingStartedAtRef, playerHostMode, playerRef, showUnavailableOverlayMessage]);

  return {
    notePlayAttempt,
    canProgrammaticPlaybackStart,
    shouldSuppressAutoplayForInitialPageLoad,
    scheduleStuckPlaybackWatchdog,
    scheduleStuckPlaybackRetry,
    scheduleMidPlaybackBufferingCheck,
  };
}
