import type { VideoRecord } from "@/lib/catalog";
import { parseJsonOrNull } from "@/lib/parse-json";

const RANDOM_NEXT_RECENT_EXCLUSION = 5;

export async function resolveAutoplayRecoveryTarget({
  currentVideoId,
  fallbackPoolSize,
  historyStack,
}: {
  currentVideoId: string;
  fallbackPoolSize: number;
  historyStack: string[];
}) {
  try {
    const response = await fetch(`/api/current-video?v=${encodeURIComponent(currentVideoId)}&count=${fallbackPoolSize}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await parseJsonOrNull(response)) as
      | {
          relatedVideos?: VideoRecord[];
          videos?: VideoRecord[];
        }
      | null;

    const fallbackPool = Array.isArray(payload?.relatedVideos)
      ? payload.relatedVideos
      : Array.isArray(payload?.videos)
        ? payload.videos
        : [];

    const fallbackIds = Array.from(new Set(fallbackPool.map((video) => video.id))).filter(
      (videoId) => Boolean(videoId) && videoId !== currentVideoId,
    );

    if (fallbackIds.length === 0) {
      return null;
    }

    const recentIds = Array.from(new Set([...historyStack].reverse()))
      .filter((videoId) => videoId !== currentVideoId)
      .slice(0, RANDOM_NEXT_RECENT_EXCLUSION);
    const recentIdSet = new Set(recentIds);
    const freshIds = fallbackIds.filter((videoId) => !recentIdSet.has(videoId));
    const selectionPool = freshIds.length > 0 ? freshIds : fallbackIds;
    const randomIndex = Math.floor(Math.random() * selectionPool.length);

    return selectionPool[randomIndex] ?? null;
  } catch {
    return null;
  }
}
