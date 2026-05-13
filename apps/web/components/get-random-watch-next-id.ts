import type { VideoRecord } from "@/lib/catalog";

const RANDOM_NEXT_RECENT_EXCLUSION = 5;

export function getRandomWatchNextId({
  queue,
  topFallbackVideos,
  historyStack,
  currentVideoId,
}: {
  queue: VideoRecord[];
  topFallbackVideos: VideoRecord[];
  historyStack: string[];
  currentVideoId: string;
}) {
  const queueIds = Array.from(new Set(queue.map((video) => video.id))).filter((videoId) => videoId !== currentVideoId);
  const topFallbackVideoIds = Array.from(new Set(topFallbackVideos.map((video) => video.id))).filter(
    (videoId) => Boolean(videoId) && videoId !== currentVideoId,
  );
  const blendedCandidateIds = Array.from(new Set([...queueIds, ...topFallbackVideoIds]));

  if (blendedCandidateIds.length === 0) {
    return null;
  }

  const recentIds = Array.from(new Set([...historyStack].reverse()))
    .filter((videoId) => videoId !== currentVideoId)
    .slice(0, RANDOM_NEXT_RECENT_EXCLUSION);
  const recentIdSet = new Set(recentIds);
  const freshBlendedIds = blendedCandidateIds.filter((videoId) => !recentIdSet.has(videoId));

  const freshQueueIds = queueIds.filter((videoId) => !recentIdSet.has(videoId));
  const shouldUseTopFallback = freshQueueIds.length < 5;

  const selectionPool = shouldUseTopFallback
    ? (freshBlendedIds.length > 0 ? freshBlendedIds : blendedCandidateIds)
    : freshQueueIds;

  if (selectionPool.length === 0) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * selectionPool.length);
  return selectionPool[randomIndex] ?? null;
}
