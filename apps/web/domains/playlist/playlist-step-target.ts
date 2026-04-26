export type PlaylistStepTarget = {
  videoId: string;
  playlistItemIndex: number;
};

export function resolvePlaylistStepTarget(options: {
  hasActivePlaylistContext: boolean;
  playlistQueueIds: string[];
  effectivePlaylistIndex: number | null;
  step: 1 | -1;
}): PlaylistStepTarget | null {
  const {
    hasActivePlaylistContext,
    playlistQueueIds,
    effectivePlaylistIndex,
    step,
  } = options;

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
  };
}
