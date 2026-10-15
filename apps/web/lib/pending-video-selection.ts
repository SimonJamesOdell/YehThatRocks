import type { VideoRecord } from "@/lib/catalog";

export type PendingVideoSelection = Partial<VideoRecord> & { id?: string };

/**
 * Builds an optimistic VideoRecord from a pending sessionStorage selection.
 *
 * Returns `null` when the selection cannot be applied (wrong video id, or a
 * missing/empty title). A selection with an id but no title must never be
 * merged onto the previous video: that would produce a record whose id is the
 * requested id but whose title still belongs to another video, and that wrong
 * title gets stamped into the browser tab by `useVideoPageTitle`.
 */
export function buildOptimisticVideoFromPendingSelection(
  pendingSelection: PendingVideoSelection,
  requestedVideoId: string,
  previousVideo: VideoRecord,
): VideoRecord | null {
  if (pendingSelection.id !== requestedVideoId) {
    return null;
  }

  const pendingTitle =
    typeof pendingSelection.title === "string"
      ? pendingSelection.title.trim()
      : "";

  if (pendingTitle.length === 0) {
    return null;
  }

  return {
    ...previousVideo,
    id: requestedVideoId,
    title: pendingTitle,
    channelTitle:
      typeof pendingSelection.channelTitle === "string"
        ? pendingSelection.channelTitle
        : previousVideo.channelTitle,
    genre:
      typeof pendingSelection.genre === "string"
        ? pendingSelection.genre
        : previousVideo.genre,
    favourited:
      typeof pendingSelection.favourited === "number"
        ? pendingSelection.favourited
        : previousVideo.favourited,
    description:
      typeof pendingSelection.description === "string"
        ? pendingSelection.description
        : previousVideo.description,
  };
}
