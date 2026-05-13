export type EndOfVideoDecision =
  | {
      kind: "navigate-next";
      videoId: string;
      clearPlaylist: boolean;
      playlistItemIndex: number | null;
    }
  | { kind: "wait-playlist" }
  | { kind: "recover-route" }
  | { kind: "close-docked" }
  | { kind: "show-overlay" };

export function resolveEndOfVideoDecision({
  forceAutoplayAdvance,
  autoplayEnabled,
  autoplayRouteTransition,
  currentVideoId,
  nextVideoId,
  nextClearPlaylist,
  nextPlaylistIndex,
  hasActivePlaylistIntent,
  pathname,
}: {
  forceAutoplayAdvance: boolean;
  autoplayEnabled: boolean;
  autoplayRouteTransition: boolean;
  currentVideoId: string;
  nextVideoId: string | null;
  nextClearPlaylist: boolean;
  nextPlaylistIndex: number | null;
  hasActivePlaylistIntent: boolean;
  pathname: string;
}): EndOfVideoDecision {
  const autoplayEnabledForCurrentTrack = autoplayEnabled && !autoplayRouteTransition && currentVideoId.length > 0;
  const shouldAutoAdvance = autoplayEnabledForCurrentTrack || forceAutoplayAdvance;

  if (shouldAutoAdvance && nextVideoId) {
    return {
      kind: "navigate-next",
      videoId: nextVideoId,
      clearPlaylist: nextClearPlaylist,
      playlistItemIndex: nextPlaylistIndex,
    };
  }

  if (shouldAutoAdvance && hasActivePlaylistIntent) {
    return { kind: "wait-playlist" };
  }

  if (shouldAutoAdvance) {
    return { kind: "recover-route" };
  }

  if (!autoplayEnabled) {
    return pathname !== "/" ? { kind: "close-docked" } : { kind: "show-overlay" };
  }

  return { kind: "show-overlay" };
}
