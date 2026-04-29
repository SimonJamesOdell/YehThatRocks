import type { VideoRecord } from "@/lib/catalog";
import type { QueueRemovalReason } from "@/lib/events-contract";

export type QueueMutation =
  | { type: "add"; track: VideoRecord }
  | { type: "remove"; videoId: string; reason: QueueRemovalReason }
  | { type: "clear" };

export function mutateTemporaryQueue(currentQueue: VideoRecord[], mutation: QueueMutation): VideoRecord[] {
  switch (mutation.type) {
    case "add":
      return currentQueue.some((video) => video.id === mutation.track.id)
        ? currentQueue
        : [...currentQueue, mutation.track];
    case "remove":
      return currentQueue.filter((video) => video.id !== mutation.videoId);
    case "clear":
      return [];
    default:
      return currentQueue;
  }
}

export function resolveTemporaryQueueTarget(temporaryQueue: VideoRecord[], currentVideoId: string): string | null {
  if (temporaryQueue.length === 0) {
    return null;
  }

  const currentQueueIndex = temporaryQueue.findIndex((video) => video.id === currentVideoId);
  return currentQueueIndex >= 0
    ? (temporaryQueue[currentQueueIndex + 1]?.id ?? null)
    : (temporaryQueue[0]?.id ?? null);
}
