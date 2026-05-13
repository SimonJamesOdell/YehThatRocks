"use client";

import { useCallback } from "react";

import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";
import { useLyricsAvailability } from "@/components/use-lyrics-availability";

export function usePlayerLyricsState({
  currentVideoId,
  footerActionsBlocked,
}: {
  currentVideoId: string;
  footerActionsBlocked: boolean;
}) {
  const lyricsAvailableForCurrentVideo = useLyricsAvailability(currentVideoId);
  const lyricsUnavailableForCurrentVideo = lyricsAvailableForCurrentVideo === false;
  const lyricsButtonDisabled = footerActionsBlocked || lyricsUnavailableForCurrentVideo;

  const handleOpenLyrics = useCallback(() => {
    if (lyricsUnavailableForCurrentVideo) {
      return;
    }

    dispatchAppEvent(EVENT_NAMES.RIGHT_RAIL_LYRICS_OPEN, { videoId: currentVideoId });
  }, [currentVideoId, lyricsUnavailableForCurrentVideo]);

  return {
    lyricsUnavailableForCurrentVideo,
    lyricsButtonDisabled,
    handleOpenLyrics,
  };
}
