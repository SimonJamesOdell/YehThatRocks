import type { VideoRecord } from "@/lib/catalog";
import type { NextChoiceVideo } from "@/components/player-experience-autoplay-utils";

export function buildEndedChoiceCandidateVideos({
  queue,
  topFallbackVideos,
  currentVideoId,
  endedChoiceDismissedIds,
  endedChoiceReshuffleKey,
  endedChoiceBatchSize,
}: {
  queue: VideoRecord[];
  topFallbackVideos: VideoRecord[];
  currentVideoId: string;
  endedChoiceDismissedIds: string[];
  endedChoiceReshuffleKey: number;
  endedChoiceBatchSize: number;
}) {
  const deduped = new Map<string, NextChoiceVideo>();

  for (const video of [...queue, ...topFallbackVideos]) {
    if (!video?.id || video.id === currentVideoId || deduped.has(video.id)) {
      continue;
    }

    deduped.set(video.id, video);
  }

  const all = [...deduped.values()].filter((video) => !endedChoiceDismissedIds.includes(video.id));
  const offset = (endedChoiceReshuffleKey * endedChoiceBatchSize) % Math.max(all.length, 1);
  return [...all.slice(offset), ...all.slice(0, offset)];
}

export function buildEndedChoiceVideos({
  endedChoiceCandidateVideos,
  endedChoiceBatchSize,
  endedChoiceRemoteVideos,
  currentVideoId,
  endedChoiceDismissedIds,
}: {
  endedChoiceCandidateVideos: NextChoiceVideo[];
  endedChoiceBatchSize: number;
  endedChoiceRemoteVideos: VideoRecord[];
  currentVideoId: string;
  endedChoiceDismissedIds: string[];
}) {
  const deduped = new Map<string, NextChoiceVideo>();

  for (const video of [...endedChoiceCandidateVideos.slice(0, endedChoiceBatchSize), ...endedChoiceRemoteVideos]) {
    if (!video?.id || video.id === currentVideoId || endedChoiceDismissedIds.includes(video.id) || deduped.has(video.id)) {
      continue;
    }

    deduped.set(video.id, video);
  }

  return [...deduped.values()];
}
