import type { VideoRecord } from "@/lib/catalog";
import { resolvePostDeleteNextVideo } from "@/components/player-experience-share-admin-domain";

export function resolveCatalogDeleteNavigationTarget({
  removedVideoId,
  resolvedNextVideoId,
  playlistQueueIds,
  activePlaylistId,
  effectivePlaylistIndex,
  temporaryQueue,
  queue,
}: {
  removedVideoId: string;
  resolvedNextVideoId: string | null;
  playlistQueueIds: string[];
  activePlaylistId: string | null;
  effectivePlaylistIndex: number | null;
  temporaryQueue: VideoRecord[];
  queue: VideoRecord[];
}) {
  const { nextId, nextPlaylistIndex } = resolvePostDeleteNextVideo({
    removedVideoId,
    resolvedNextVideoId,
    playlistQueueIds,
    activePlaylistId,
    effectivePlaylistIndex,
    temporaryQueue,
    queue,
  });

  if (!nextId) {
    return null;
  }

  return {
    videoId: nextId,
    clearPlaylist: nextPlaylistIndex < 0,
    playlistId: nextPlaylistIndex >= 0 ? activePlaylistId : null,
    playlistItemIndex: nextPlaylistIndex >= 0 ? nextPlaylistIndex : null,
  };
}

export function navigateAfterCatalogDelete({
  removedVideoId,
  resolvedNextVideoId,
  playlistQueueIds,
  activePlaylistId,
  effectivePlaylistIndex,
  temporaryQueue,
  queue,
  navigateToVideo,
}: {
  removedVideoId: string;
  resolvedNextVideoId: string | null;
  playlistQueueIds: string[];
  activePlaylistId: string | null;
  effectivePlaylistIndex: number | null;
  temporaryQueue: VideoRecord[];
  queue: VideoRecord[];
  navigateToVideo: (
    videoId: string,
    options?: {
      clearPlaylist?: boolean;
      playlistId?: string | null;
      playlistItemIndex?: number | null;
    },
  ) => void;
}) {
  const nextTarget = resolveCatalogDeleteNavigationTarget({
    removedVideoId,
    resolvedNextVideoId,
    playlistQueueIds,
    activePlaylistId,
    effectivePlaylistIndex,
    temporaryQueue,
    queue,
  });

  if (!nextTarget) {
    return false;
  }

  navigateToVideo(nextTarget.videoId, nextTarget);
  return true;
}
