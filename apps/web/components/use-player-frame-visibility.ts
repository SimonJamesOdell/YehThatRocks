"use client";

import { useCallback, type Dispatch, type FocusEvent, type SetStateAction } from "react";

export function usePlayerFrameVisibility({
  isPlaying,
  allowDirectIframeInteraction,
  setShowControls,
  setShowShareMenu,
}: {
  isPlaying: boolean;
  allowDirectIframeInteraction: boolean;
  setShowControls: Dispatch<SetStateAction<boolean>>;
  setShowShareMenu: Dispatch<SetStateAction<boolean>>;
}) {
  const handlePlayerFrameMouseEnter = useCallback(() => {
    if (!allowDirectIframeInteraction) {
      setShowControls(true);
    }
  }, [allowDirectIframeInteraction, setShowControls]);

  const handlePlayerFrameMouseLeave = useCallback(() => {
    if (isPlaying && !allowDirectIframeInteraction) {
      setShowControls(false);
      setShowShareMenu(false);
    }
  }, [allowDirectIframeInteraction, isPlaying, setShowControls, setShowShareMenu]);

  const handlePlayerFrameFocusCapture = useCallback(() => {
    setShowControls(true);
  }, [setShowControls]);

  const handlePlayerFrameBlurCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const nextFocusedNode = event.relatedTarget;

    if (!(nextFocusedNode instanceof Node) || !event.currentTarget.contains(nextFocusedNode)) {
      if (isPlaying) {
        setShowControls(false);
        setShowShareMenu(false);
      }
    }
  }, [isPlaying, setShowControls, setShowShareMenu]);

  return {
    handlePlayerFrameMouseEnter,
    handlePlayerFrameMouseLeave,
    handlePlayerFrameFocusCapture,
    handlePlayerFrameBlurCapture,
  };
}
