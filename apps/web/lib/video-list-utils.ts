// Client-safe (no prisma import) utilities for deduplicating and filtering
// VideoRecord arrays. Shared across all client-side infinite-list components
// (category-videos-infinite, new-videos-loader, shell-dynamic-core, top100-videos-loader).

import type { VideoRecord } from "@/lib/catalog";

/**
 * Returns a new array with duplicate video IDs removed, preserving first-occurrence order.
 * Null/undefined rows and rows with a falsy id are skipped (defensive guard for API data).
 */
export function dedupeVideos(videos: VideoRecord[]): VideoRecord[] {
  const seen = new Set<string>();
  const unique: VideoRecord[] = [];

  for (const video of videos) {
    if (!video?.id || seen.has(video.id)) {
      continue;
    }

    seen.add(video.id);
    unique.push(video);
  }

  return unique;
}

/**
 * Returns a new array with videos whose id appears in hiddenVideoIdSet removed.
 * Returns the original array reference unchanged when the set is empty (no allocation).
 */
export function filterHiddenVideos(videos: VideoRecord[], hiddenVideoIdSet: Set<string>): VideoRecord[] {
  if (hiddenVideoIdSet.size === 0) {
    return videos;
  }

  return videos.filter((video) => !hiddenVideoIdSet.has(video.id));
}
