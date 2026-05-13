"use client";

import { useCallback } from "react";

type HideCurrentVideoState = "idle" | "saving";

type HideMutationResult = {
  ok: boolean;
  payload?: { activePlaylistDeleted?: boolean };
};

export function useHideCurrentVideoAction({
  isLoggedIn,
  hideCurrentVideoState,
  currentVideoId,
  activePlaylistId,
  setHideCurrentVideoState,
  showManualTransitionMask,
  mutateHiddenVideoFn,
  onPlaylistsUpdated,
  onActivePlaylistDeleted,
  triggerEndOfVideoAction,
  getAutoplayEnabled,
}: {
  isLoggedIn: boolean;
  hideCurrentVideoState: HideCurrentVideoState;
  currentVideoId: string;
  activePlaylistId: string | null;
  setHideCurrentVideoState: (value: HideCurrentVideoState) => void;
  showManualTransitionMask: () => void;
  mutateHiddenVideoFn: (params: {
    action: "hide";
    videoId: string;
    activePlaylistId: string | null;
  }) => Promise<HideMutationResult>;
  onPlaylistsUpdated: () => void;
  onActivePlaylistDeleted: () => void;
  triggerEndOfVideoAction: (options?: { forceAutoplayAdvance?: boolean }) => void;
  getAutoplayEnabled: () => boolean;
}) {
  const handleHideCurrentVideo = useCallback(async () => {
    if (!isLoggedIn || hideCurrentVideoState === "saving") {
      return;
    }

    setHideCurrentVideoState("saving");
    showManualTransitionMask();

    try {
      const result = await mutateHiddenVideoFn({
        action: "hide",
        videoId: currentVideoId,
        activePlaylistId,
      });

      if (result.ok) {
        onPlaylistsUpdated();

        if (result.payload?.activePlaylistDeleted) {
          onActivePlaylistDeleted();
        }
      }
    } catch {
      // Keep skip flow responsive even if hide persistence fails.
    } finally {
      setHideCurrentVideoState("idle");
      triggerEndOfVideoAction({
        forceAutoplayAdvance: getAutoplayEnabled(),
      });
    }
  }, [
    activePlaylistId,
    currentVideoId,
    getAutoplayEnabled,
    hideCurrentVideoState,
    isLoggedIn,
    mutateHiddenVideoFn,
    onActivePlaylistDeleted,
    onPlaylistsUpdated,
    setHideCurrentVideoState,
    showManualTransitionMask,
    triggerEndOfVideoAction,
  ]);

  return {
    handleHideCurrentVideo,
  };
}
