import { useCallback, useMemo } from "react";

import {
  type ResolveNextTrackTargetOptions,
  type ResolveTarget,
  resolveNextTrackTarget,
} from "@/domains/player/resolve-next-track-target";
import { resolvePlaylistStepTarget as resolvePlaylistStepTargetDomain } from "@/domains/playlist/playlist-step-target";

type UseNextTrackDecisionOptions = ResolveNextTrackTargetOptions;

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
    const target = resolvePlaylistStepTargetDomain({
      hasActivePlaylistContext,
      playlistQueueIds,
      effectivePlaylistIndex,
      step,
    });

    if (!target) {
      return null;
    }

    return {
      videoId: target.videoId,
      playlistItemIndex: target.playlistItemIndex,
      clearPlaylist: false,
    };
  }, [effectivePlaylistIndex, hasActivePlaylistContext, playlistQueueIds]);

  const resolveNextTarget = useCallback((): ResolveTarget | null => {
    return resolveNextTrackTarget({
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
    });
  }, [
    activePlaylistId,
    autoplayEnabled,
    currentVideoId,
    effectivePlaylistIndex,
    getRandomWatchNextId,
    hasActivePlaylistContext,
    isDockedDesktop,
    playlistQueueIds,
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
