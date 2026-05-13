import type { VideoRecord } from "@/lib/catalog";
import { dedupeVideos } from "@/lib/video-list-utils";

export function formatChatTimestamp(value: string | null) {
  if (!value) {
    return "Now";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Now";
  }
  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function isFavouriteVideo(video: VideoRecord) {
  return Number(video.favourited ?? 0) > 0;
}

export function logFlow(enabled: boolean, event: string, detail?: Record<string, unknown>) {
  if (!enabled) {
    return;
  }
  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[flow/shell] ${event}${payload}`);
}

export function logWatchNext(event: string, detail?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }
  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[watch-next] ${event}${payload}`);
}

export function finiteNumberOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function finitePercentOrNull(value: number | null | undefined) {
  const numeric = finiteNumberOrNull(value);
  return numeric === null ? null : Math.max(0, Math.min(100, numeric));
}

export function dedupeRelatedRailVideos(videos: VideoRecord[], currentVideoId: string) {
  return dedupeVideos(videos).filter((video) => video.id !== currentVideoId);
}

export function matchesPlaylistVideoOrder(a: { id: string }[], b: { id: string }[]) {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index]?.id !== b[index]?.id) {
      return false;
    }
  }
  return true;
}

export function sortVideosBySeen(videos: VideoRecord[], seenVideoIdSet: Set<string>) {
  if (seenVideoIdSet.size === 0) {
    return videos;
  }
  const unseen: VideoRecord[] = [];
  const seen: VideoRecord[] = [];
  for (const video of videos) {
    if (seenVideoIdSet.has(video.id)) {
      seen.push(video);
    } else {
      unseen.push(video);
    }
  }
  return [...unseen, ...seen];
}
