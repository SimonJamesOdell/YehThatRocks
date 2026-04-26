import { useCallback, useMemo } from "react";

import type { VideoRecord } from "@/lib/catalog";

type ResolveTarget = {
  videoId: string;
  playlistItemIndex: number | null;
  clearPlaylist: boolean;
};

type UseNextTrackDecisionOptions = {
  activePlaylistId: string | null;
  hasActivePlaylistContext: boolean;
  playlistQueueIds: string[];
  effectivePlaylistIndex: number | null;
  temporaryQueue: VideoRecord[];
  currentVideoId: string;
  isDockedDesktop: boolean;
  autoplayEnabled: boolean;
  routeAutoplayQueueIds: string[];
  getRandomWatchNextId: () => string | null;
};

export function useNextTrackDecision({
  activePlaylistId,
  hasActivePlaylistContext,
  playlistQueueIds,
  effectivePlaylistIndex,
  temporaryQueue,
  currentVideoId,
  isDockedDesktop,
  autoplayEnabled,
  routeAutoplayQueueIds,
  getRandomWatchNextId,
}: UseNextTrackDecisionOptions) {
  const resolvePlaylistStepTarget = useCallback((step: 1 | -1): ResolveTarget | null => {
    if (!hasActivePlaylistContext || playlistQueueIds.length === 0) {
      return null;
    }

    const fallbackIndex = step > 0 ? 0 : Math.max(0, playlistQueueIds.length - 1);
    const baseIndex = effectivePlaylistIndex ?? fallbackIndex;
    const wrappedIndex =
      step > 0
        ? (baseIndex + 1) % playlistQueueIds.length
        : (baseIndex - 1 + playlistQueueIds.length) % playlistQueueIds.length;
    const videoId = playlistQueueIds[wrappedIndex] ?? null;

    if (!videoId) {
      return null;
    }

    return {
      videoId,
      playlistItemIndex: wrappedIndex,
      clearPlaylist: false,
    };
  }, [effectivePlaylistIndex, hasActivePlaylistContext, playlistQueueIds]);

  const resolveNextTarget = useCallback((): ResolveTarget | null => {
    if (activePlaylistId) {
      const nextPlaylistTarget = resolvePlaylistStepTarget(1);
      if (nextPlaylistTarget) {
        return nextPlaylistTarget;
      }

      // A playlist is selected but not ready yet; do not switch to random Watch Next.
      return null;
    }

    if (temporaryQueue.length > 0) {
      const currentQueueIndex = temporaryQueue.findIndex((video) => video.id === currentVideoId);
      const nextQueuedVideoId = currentQueueIndex >= 0
        ? (temporaryQueue[currentQueueIndex + 1]?.id ?? null)
        : (temporaryQueue[0]?.id ?? null);

      if (nextQueuedVideoId) {
        return {
          videoId: nextQueuedVideoId,
          playlistItemIndex: null,
          clearPlaylist: true,
        };
      }
    }

    if (isDockedDesktop && autoplayEnabled && routeAutoplayQueueIds.length > 0) {
      const currentIndex = routeAutoplayQueueIds.findIndex((videoId) => videoId === currentVideoId);
      const fallbackIndex = routeAutoplayQueueIds.findIndex((videoId) => videoId !== currentVideoId);
      const nextIndex = currentIndex >= 0
        ? (currentIndex + 1) % routeAutoplayQueueIds.length
        : fallbackIndex;
      const nextId = nextIndex >= 0 ? routeAutoplayQueueIds[nextIndex] ?? null : null;

      if (nextId) {
        return {
          videoId: nextId,
          playlistItemIndex: null,
          clearPlaylist: true,
        };
      }
    }

    const randomWatchNextId = getRandomWatchNextId();

    if (!randomWatchNextId) {
      return null;
    }

    return {
      videoId: randomWatchNextId,
      playlistItemIndex: null,
      clearPlaylist: true,
    };
  }, [
    activePlaylistId,
    autoplayEnabled,
    currentVideoId,
    getRandomWatchNextId,
    isDockedDesktop,
    resolvePlaylistStepTarget,
    routeAutoplayQueueIds,
    temporaryQueue,
  ]);

  const resolvedNextTarget = useMemo(() => resolveNextTarget(), [resolveNextTarget]);

  return {
    resolvePlaylistStepTarget,
    resolveNextTarget,
    resolvedNextTarget,
  };
}
