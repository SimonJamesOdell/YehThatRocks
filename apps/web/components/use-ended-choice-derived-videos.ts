"use client";

import { useMemo } from "react";

import type { VideoRecord } from "@/lib/catalog";

export function useEndedChoiceDerivedVideos({
  queue,
  topFallbackVideos,
  currentVideoId,
  endedChoiceDismissedIds,
  endedChoiceReshuffleKey,
  endedChoiceBatchSize,
  endedChoiceRemoteVideos,
  isLoggedIn,
  seenVideoIds,
  endedChoiceHideSeen,
  endedChoiceLoading,
  endedChoiceHasMore,
}: {
  queue: VideoRecord[];
  topFallbackVideos: VideoRecord[];
  currentVideoId: string;
  endedChoiceDismissedIds: string[];
  endedChoiceReshuffleKey: number;
  endedChoiceBatchSize: number;
  endedChoiceRemoteVideos: VideoRecord[];
  isLoggedIn: boolean;
  seenVideoIds?: Set<string>;
  endedChoiceHideSeen: boolean;
  endedChoiceLoading: boolean;
  endedChoiceHasMore: boolean;
}) {
  const endedChoiceCandidateVideos = useMemo(() => {
    const deduped = new Map<string, VideoRecord>();

    for (const video of [...queue, ...topFallbackVideos]) {
      if (!video?.id || video.id === currentVideoId || deduped.has(video.id)) {
        continue;
      }

      deduped.set(video.id, video);
    }

    const all = [...deduped.values()].filter((video) => !endedChoiceDismissedIds.includes(video.id));
    const offset = (endedChoiceReshuffleKey * endedChoiceBatchSize) % Math.max(all.length, 1);
    return [...all.slice(offset), ...all.slice(0, offset)];
  }, [queue, topFallbackVideos, currentVideoId, endedChoiceReshuffleKey, endedChoiceBatchSize, endedChoiceDismissedIds]);

  const endedChoiceVideos = useMemo(() => {
    const deduped = new Map<string, VideoRecord>();

    for (const video of [...endedChoiceCandidateVideos.slice(0, endedChoiceBatchSize), ...endedChoiceRemoteVideos]) {
      if (!video?.id || video.id === currentVideoId || endedChoiceDismissedIds.includes(video.id) || deduped.has(video.id)) {
        continue;
      }

      deduped.set(video.id, video);
    }

    return [...deduped.values()];
  }, [endedChoiceCandidateVideos, endedChoiceBatchSize, endedChoiceRemoteVideos, currentVideoId, endedChoiceDismissedIds]);

  const hasSeenEndedChoiceVideos = isLoggedIn && endedChoiceVideos.some((video) => seenVideoIds?.has(video.id));
  const visibleEndedChoiceVideos = isLoggedIn && endedChoiceHideSeen
    ? endedChoiceVideos.filter((video) => !(seenVideoIds?.has(video.id) ?? false))
    : endedChoiceVideos;

  const endedChoiceGridVideos = useMemo(() => {
    if (!endedChoiceHideSeen) {
      return visibleEndedChoiceVideos;
    }

    const fullRowCount = Math.floor(visibleEndedChoiceVideos.length / 4) * 4;
    return visibleEndedChoiceVideos.slice(0, fullRowCount);
  }, [endedChoiceHideSeen, visibleEndedChoiceVideos]);

  const shouldShowEndedChoiceEmptyState = endedChoiceGridVideos.length === 0
    && !endedChoiceLoading
    && (!endedChoiceHideSeen || !endedChoiceHasMore);

  return {
    endedChoiceVideos,
    hasSeenEndedChoiceVideos,
    visibleEndedChoiceVideos,
    endedChoiceGridVideos,
    shouldShowEndedChoiceEmptyState,
  };
}
