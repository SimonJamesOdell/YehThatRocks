"use client";

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { EVENT_NAMES, listenToAppEvent } from "@/lib/events-contract";

export function usePlayerRuntimeEventListeners({
  setPlaylistChooserOpen,
  pointerPositionRef,
  pauseActivePlayback,
  currentVideoIdRef,
  showEndedChoiceOverlay,
  handleEndedChoiceWatchAgain,
  playerPreferencesSaveTimeoutRef,
}: {
  setPlaylistChooserOpen: Dispatch<SetStateAction<boolean>>;
  pointerPositionRef: MutableRefObject<{ x: number; y: number }>;
  pauseActivePlayback: () => void;
  currentVideoIdRef: MutableRefObject<string>;
  showEndedChoiceOverlay: boolean;
  handleEndedChoiceWatchAgain: () => void;
  playerPreferencesSaveTimeoutRef: MutableRefObject<number | null>;
}) {
  useEffect(() => {
    const unsubscribePlaylistChooserState = listenToAppEvent(EVENT_NAMES.PLAYLIST_CHOOSER_STATE, ({ isOpen }) => {
      setPlaylistChooserOpen(Boolean(isOpen));
    });
    return () => unsubscribePlaylistChooserState();
  }, [setPlaylistChooserOpen]);

  useEffect(() => {
    function handlePointerMove(event: MouseEvent) {
      pointerPositionRef.current = { x: event.clientX, y: event.clientY };
    }

    window.addEventListener("mousemove", handlePointerMove);
    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
    };
  }, [pointerPositionRef]);

  useEffect(() => {
    function handleAdminOverlayEnter() {
      pauseActivePlayback();
    }

    const unsubscribe = listenToAppEvent(EVENT_NAMES.ADMIN_OVERLAY_ENTER, handleAdminOverlayEnter);
    return () => unsubscribe();
  }, [pauseActivePlayback]);

  useEffect(() => {
    function handleReplayRequest(payload: { videoId: string }) {
      const requestedVideoId = typeof payload.videoId === "string" ? payload.videoId : null;

      if (!requestedVideoId || requestedVideoId !== currentVideoIdRef.current) {
        return;
      }

      if (!showEndedChoiceOverlay) {
        return;
      }

      handleEndedChoiceWatchAgain();
    }

    const unsubscribe = listenToAppEvent(EVENT_NAMES.REQUEST_VIDEO_REPLAY, handleReplayRequest);
    return () => unsubscribe();
  }, [currentVideoIdRef, handleEndedChoiceWatchAgain, showEndedChoiceOverlay]);

  useEffect(() => {
    return () => {
      if (playerPreferencesSaveTimeoutRef.current !== null) {
        window.clearTimeout(playerPreferencesSaveTimeoutRef.current);
        playerPreferencesSaveTimeoutRef.current = null;
      }
    };
  }, [playerPreferencesSaveTimeoutRef]);
}
