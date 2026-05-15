"use client";

import { useCallback, type MutableRefObject } from "react";

import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";
import { parseJsonOrNull } from "@/lib/parse-json";

export function usePlayerWatchHistoryReporting({
  currentVideoIdRef,
  playerRef,
  currentTime,
  duration,
  hasPlaybackStartedRef,
  watchHistoryLevelRef,
  watchHistoryRefreshBlockedUntilRef,
  watchHistoryRefreshInFlightRef,
  toSafeNumber,
}: {
  currentVideoIdRef: MutableRefObject<string>;
  playerRef: MutableRefObject<{
    getCurrentTime?: () => number;
    getDuration?: () => number;
  } | null>;
  currentTime: number;
  duration: number;
  hasPlaybackStartedRef: MutableRefObject<boolean>;
  watchHistoryLevelRef: MutableRefObject<Map<string, number>>;
  watchHistoryRefreshBlockedUntilRef: MutableRefObject<number>;
  watchHistoryRefreshInFlightRef: MutableRefObject<Promise<boolean> | null>;
  toSafeNumber: (value: unknown, fallback?: number) => number;
}) {
  const reportWatchEvent = useCallback(async (level: number, reason: "qualified" | "ended", explicitTime?: number, explicitDuration?: number) => {
    const activeVideoId = currentVideoIdRef.current;
    const currentLevel = watchHistoryLevelRef.current.get(activeVideoId) ?? 0;
    if (currentLevel >= level) {
      return;
    }

    const player = playerRef.current;
    const positionSec = Math.max(
      0,
      Math.floor(
        explicitTime
          ?? (typeof player?.getCurrentTime === "function" ? toSafeNumber(player.getCurrentTime(), 0) : currentTime),
      ),
    );
    const durationSec = Math.max(
      0,
      Math.floor(
        explicitDuration
          ?? (typeof player?.getDuration === "function" ? toSafeNumber(player.getDuration(), 0) : duration),
      ),
    );
    const progressPercent = durationSec > 0
      ? Math.min(100, Math.max(0, (positionSec / durationSec) * 100))
      : 0;

    const hasPlaybackEvidence = hasPlaybackStartedRef.current || positionSec > 0 || progressPercent > 0;
    if (!hasPlaybackEvidence) {
      return;
    }

    watchHistoryLevelRef.current.set(activeVideoId, level);

    try {
      const requestPayload = {
        videoId: activeVideoId,
        reason,
        positionSec,
        durationSec,
        progressPercent,
      };

      const sendWatchHistory = async () => fetch("/api/watch-history", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      });

      const refreshAccessTokenForWatchHistory = async () => {
        const now = Date.now();

        if (watchHistoryRefreshBlockedUntilRef.current > now) {
          return false;
        }

        const inFlight = watchHistoryRefreshInFlightRef.current;
        if (inFlight) {
          return inFlight;
        }

        const pending = (async () => {
          try {
            const refreshResponse = await fetch("/api/auth/refresh", {
              method: "POST",
              credentials: "same-origin",
              headers: {
                "Content-Type": "application/json",
              },
              body: "{}",
            });

            if (!refreshResponse.ok) {
              watchHistoryRefreshBlockedUntilRef.current = Date.now() + 60_000;
              return false;
            }

            return true;
          } catch {
            watchHistoryRefreshBlockedUntilRef.current = Date.now() + 60_000;
            return false;
          }
        })();

        watchHistoryRefreshInFlightRef.current = pending;

        try {
          return await pending;
        } finally {
          if (watchHistoryRefreshInFlightRef.current === pending) {
            watchHistoryRefreshInFlightRef.current = null;
          }
        }
      };

      let response = await sendWatchHistory();

      if (!response.ok && (response.status === 401 || response.status === 403)) {
        const refreshed = await refreshAccessTokenForWatchHistory();
        if (refreshed) {
          response = await sendWatchHistory();
        }
      }

      if (!response.ok) {
        watchHistoryLevelRef.current.set(activeVideoId, currentLevel);
      } else {
        const payload = (await parseJsonOrNull(response)) as { ok?: boolean } | null;
        if (!payload?.ok) {
          watchHistoryLevelRef.current.set(activeVideoId, currentLevel);
          return;
        }

        if (typeof window !== "undefined") {
          dispatchAppEvent(EVENT_NAMES.WATCH_HISTORY_UPDATED, { videoId: activeVideoId });
        }
      }
    } catch {
      watchHistoryLevelRef.current.set(activeVideoId, currentLevel);
    }
  }, [currentTime, currentVideoIdRef, duration, hasPlaybackStartedRef, playerRef, toSafeNumber, watchHistoryLevelRef, watchHistoryRefreshBlockedUntilRef, watchHistoryRefreshInFlightRef]);

  return { reportWatchEvent };
}
