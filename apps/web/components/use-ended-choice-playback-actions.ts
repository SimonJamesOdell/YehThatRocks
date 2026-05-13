"use client";

import { useCallback, type MutableRefObject } from "react";

type PlaybackPlayer = {
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
};

export function useEndedChoicePlaybackActions({
  activePlaylistId,
  playlistQueueIds,
  navigateToVideo,
  setShowEndedChoiceOverlay,
  setEndedChoiceFromUnavailable,
  setPlayerClosedByEndOfVideo,
  playerRef,
  hasUserGesturePlaybackUnlockRef,
  notePlayAttempt,
}: {
  activePlaylistId: string | null;
  playlistQueueIds: string[];
  navigateToVideo: (
    videoId: string,
    options?: {
      clearPlaylist?: boolean;
      playlistId?: string | null;
      playlistItemIndex?: number | null;
      useNativeHistory?: boolean;
    },
  ) => void;
  setShowEndedChoiceOverlay: (value: boolean) => void;
  setEndedChoiceFromUnavailable: (value: boolean) => void;
  setPlayerClosedByEndOfVideo: (value: boolean) => void;
  playerRef: MutableRefObject<PlaybackPlayer | null>;
  hasUserGesturePlaybackUnlockRef: MutableRefObject<boolean>;
  notePlayAttempt: () => void;
}) {
  const handleEndedChoiceSelect = useCallback((videoId: string) => {
    const playlistIndex = playlistQueueIds.findIndex((candidateId) => candidateId === videoId);

    hasUserGesturePlaybackUnlockRef.current = true;
    setShowEndedChoiceOverlay(false);
    setEndedChoiceFromUnavailable(false);
    navigateToVideo(videoId, {
      clearPlaylist: playlistIndex < 0,
      playlistId: playlistIndex >= 0 ? activePlaylistId : null,
      playlistItemIndex: playlistIndex >= 0 ? playlistIndex : null,
    });
  }, [activePlaylistId, hasUserGesturePlaybackUnlockRef, navigateToVideo, playlistQueueIds, setEndedChoiceFromUnavailable, setShowEndedChoiceOverlay]);

  const handleEndedChoiceWatchAgain = useCallback(() => {
    setShowEndedChoiceOverlay(false);
    setEndedChoiceFromUnavailable(false);
    setPlayerClosedByEndOfVideo(false);

    if (!playerRef.current) {
      return;
    }

    playerRef.current.seekTo(0, true);
    hasUserGesturePlaybackUnlockRef.current = true;
    notePlayAttempt();
    playerRef.current.playVideo();
  }, [hasUserGesturePlaybackUnlockRef, notePlayAttempt, playerRef, setEndedChoiceFromUnavailable, setPlayerClosedByEndOfVideo, setShowEndedChoiceOverlay]);

  return {
    handleEndedChoiceSelect,
    handleEndedChoiceWatchAgain,
  };
}
