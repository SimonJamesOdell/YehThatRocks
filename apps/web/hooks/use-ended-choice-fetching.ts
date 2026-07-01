"use client";

import { startTransition, useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import type { VideoRecord } from "@/lib/catalog";
import { parseJsonOrNull } from "@/lib/parse-json";

export function useEndedChoiceFetching({
  currentVideoId,
  endedChoiceHideSeen,
  endedChoiceRemoteVideos,
  endedChoiceBatchSize,
  endedChoiceFetchingRef,
  endedChoiceHasMoreRef,
  endedChoiceSkipRef,
  endedChoiceNoProgressStreakRef,
  endedChoiceFailureStreakRef,
  endedChoiceAutoRetryBlockedUntilRef,
  endedChoicePostPrimeQueuedRef,
  endedChoiceUserScrolledRef,
  setEndedChoiceAnimateCards,
  setEndedChoiceLoading,
  setEndedChoiceRemoteVideos,
}: {
  currentVideoId: string;
  endedChoiceHideSeen: boolean;
  endedChoiceRemoteVideos: VideoRecord[];
  endedChoiceBatchSize: number;
  endedChoiceFetchingRef: MutableRefObject<boolean>;
  endedChoiceHasMoreRef: MutableRefObject<boolean>;
  endedChoiceSkipRef: MutableRefObject<number>;
  endedChoiceNoProgressStreakRef: MutableRefObject<number>;
  endedChoiceFailureStreakRef: MutableRefObject<number>;
  endedChoiceAutoRetryBlockedUntilRef: MutableRefObject<number>;
  endedChoicePostPrimeQueuedRef: MutableRefObject<boolean>;
  endedChoiceUserScrolledRef: MutableRefObject<boolean>;
  setEndedChoiceAnimateCards: Dispatch<SetStateAction<boolean>>;
  setEndedChoiceLoading: Dispatch<SetStateAction<boolean>>;
  setEndedChoiceRemoteVideos: Dispatch<SetStateAction<VideoRecord[]>>;
}) {
  const fetchEndedChoiceSets = useCallback(async (
    requestedCount: number,
    options?: { background?: boolean; schedulePostPrimeBatch?: boolean },
  ) => {
    const isBackground = options?.background === true;
    const shouldSchedulePostPrimeBatch = options?.schedulePostPrimeBatch === true;
    const applyRetryBackoff = (baseMs: number) => {
      if (!isBackground) {
        return;
      }

      const failureStreak = Math.max(1, endedChoiceFailureStreakRef.current);
      const cappedBackoff = Math.min(15_000, baseMs * Math.min(8, failureStreak));
      endedChoiceAutoRetryBlockedUntilRef.current = Date.now() + cappedBackoff;
    };

    if (isBackground && Date.now() < endedChoiceAutoRetryBlockedUntilRef.current) {
      return;
    }

    if (requestedCount <= 0 || endedChoiceFetchingRef.current || !endedChoiceHasMoreRef.current) {
      return;
    }

    const take = Math.max(1, Math.min(60, Math.floor(requestedCount)));
    const skip = endedChoiceSkipRef.current;
    endedChoiceFetchingRef.current = true;
    if (!isBackground) {
      setEndedChoiceLoading(true);
    }

    try {
      const params = new URLSearchParams();
      params.set("v", currentVideoId);
      params.set("count", String(take));
      params.set("offset", String(skip));
      params.set("mode", "ended-choice");
      params.set("hideSeen", endedChoiceHideSeen ? "1" : "0");

      const response = await fetch(`/api/current-video?${params.toString()}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        endedChoiceFailureStreakRef.current += 1;
        applyRetryBackoff(1_200);
        return;
      }

      endedChoiceFailureStreakRef.current = 0;

      const payload = (await parseJsonOrNull(response)) as
        | {
            videos?: VideoRecord[];
            relatedVideos?: VideoRecord[];
            hasMore?: boolean;
          }
        | null;

      const fetchedVideosRaw = Array.isArray(payload?.relatedVideos)
        ? payload.relatedVideos
        : Array.isArray(payload?.videos)
          ? payload.videos
          : [];
      const fetchedVideos = fetchedVideosRaw.filter((video): video is VideoRecord => Boolean(video?.id) && video.id !== currentVideoId);
      const payloadHasMore = payload?.hasMore !== false;
      endedChoiceSkipRef.current = skip + fetchedVideosRaw.length;

      if (fetchedVideos.length === 0 && !payloadHasMore) {
        endedChoiceHasMoreRef.current = false;
        endedChoiceNoProgressStreakRef.current = 0;
        return;
      }

      if (!payloadHasMore) {
        endedChoiceHasMoreRef.current = false;
      }

      if (fetchedVideos.length === 0) {
        endedChoiceNoProgressStreakRef.current += 1;
        if (endedChoiceNoProgressStreakRef.current >= 3) {
          endedChoiceHasMoreRef.current = false;
        } else {
          applyRetryBackoff(1_500);
        }
        return;
      }

      const existingIds = new Set(endedChoiceRemoteVideos.map((video) => video.id));
      const uniqueToAdd = fetchedVideos.filter((video) => !existingIds.has(video.id));
      const addedCount = uniqueToAdd.length;

      if (addedCount > 0) {
        startTransition(() => {
          setEndedChoiceRemoteVideos((previous) => {
            const previousIds = new Set(previous.map((video) => video.id));
            const next = [...previous];

            for (const video of uniqueToAdd) {
              if (previousIds.has(video.id)) {
                continue;
              }

              previousIds.add(video.id);
              next.push(video);
            }

            return next;
          });
        });
      }

      if (addedCount <= 0) {
        endedChoiceNoProgressStreakRef.current += 1;
        if (endedChoiceNoProgressStreakRef.current >= 3) {
          endedChoiceHasMoreRef.current = false;
        } else {
          applyRetryBackoff(1_200);
        }
        return;
      }

      endedChoiceNoProgressStreakRef.current = 0;
      endedChoiceAutoRetryBlockedUntilRef.current = 0;

      if (
        shouldSchedulePostPrimeBatch
        && !endedChoicePostPrimeQueuedRef.current
        && endedChoiceHasMoreRef.current
        && !endedChoiceUserScrolledRef.current
      ) {
        endedChoicePostPrimeQueuedRef.current = true;
        window.setTimeout(() => {
          void fetchEndedChoiceSets(endedChoiceBatchSize, { background: true });
        }, 90);
      }

      if (skip > 0 || endedChoiceUserScrolledRef.current) {
        setEndedChoiceAnimateCards(false);
      }
    } catch {
      endedChoiceFailureStreakRef.current += 1;
      applyRetryBackoff(1_500);
    } finally {
      if (!isBackground) {
        setEndedChoiceLoading(false);
      }
      endedChoiceFetchingRef.current = false;
    }
  }, [
    currentVideoId,
    endedChoiceAutoRetryBlockedUntilRef,
    endedChoiceFailureStreakRef,
    endedChoiceFetchingRef,
    endedChoiceHasMoreRef,
    endedChoiceHideSeen,
    endedChoiceNoProgressStreakRef,
    endedChoicePostPrimeQueuedRef,
    endedChoiceRemoteVideos,
    endedChoiceSkipRef,
    endedChoiceUserScrolledRef,
    setEndedChoiceAnimateCards,
    setEndedChoiceLoading,
    setEndedChoiceRemoteVideos,
  ]);

  return { fetchEndedChoiceSets };
}
