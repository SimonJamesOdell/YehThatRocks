"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { VideoRecord } from "@/lib/catalog";

export function useEndedChoiceHideActions({
  endedChoiceHideConfirmVideo,
  endedChoiceHidingIds,
  onHideVideo,
  setEndedChoiceHideConfirmVideo,
  setEndedChoiceHidingIds,
  setEndedChoiceDismissedIds,
}: {
  endedChoiceHideConfirmVideo: VideoRecord | null;
  endedChoiceHidingIds: string[];
  onHideVideo?: (track: VideoRecord) => void | Promise<void>;
  setEndedChoiceHideConfirmVideo: (video: VideoRecord | null) => void;
  setEndedChoiceHidingIds: Dispatch<SetStateAction<string[]>>;
  setEndedChoiceDismissedIds: Dispatch<SetStateAction<string[]>>;
}) {
  const handleEndedChoiceHide = useCallback((track: VideoRecord) => {
    if (endedChoiceHidingIds.includes(track.id)) {
      return;
    }

    setEndedChoiceHideConfirmVideo(track);
  }, [endedChoiceHidingIds, setEndedChoiceHideConfirmVideo]);

  const handleEndedChoiceBrokenThumbnail = useCallback((videoId: string) => {
    setEndedChoiceDismissedIds((prev) => (prev.includes(videoId) ? prev : [...prev, videoId]));
  }, [setEndedChoiceDismissedIds]);

  const confirmEndedChoiceHide = useCallback(() => {
    const track = endedChoiceHideConfirmVideo;

    if (!track || endedChoiceHidingIds.includes(track.id)) {
      return;
    }

    setEndedChoiceHideConfirmVideo(null);
    setEndedChoiceHidingIds((prev) => [...prev, track.id]);
    void onHideVideo?.(track);
    window.setTimeout(() => {
      setEndedChoiceHidingIds((prev) => prev.filter((id) => id !== track.id));
      setEndedChoiceDismissedIds((prev) => (prev.includes(track.id) ? prev : [...prev, track.id]));
    }, 400);
  }, [endedChoiceHideConfirmVideo, endedChoiceHidingIds, onHideVideo, setEndedChoiceDismissedIds, setEndedChoiceHideConfirmVideo, setEndedChoiceHidingIds]);

  return {
    handleEndedChoiceHide,
    handleEndedChoiceBrokenThumbnail,
    confirmEndedChoiceHide,
  };
}
