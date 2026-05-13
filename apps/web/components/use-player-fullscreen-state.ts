"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

type PlayerFrameElement = HTMLDivElement | null;

export function usePlayerFullscreenState({
  playerFrameRef,
}: {
  playerFrameRef: RefObject<PlayerFrameElement>;
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleFullscreenToggle = useCallback(() => {
    if (!document.fullscreenElement) {
      playerFrameRef.current?.requestFullscreen();
    } else {
      void document.exitFullscreen();
    }
  }, [playerFrameRef]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  return {
    isFullscreen,
    handleFullscreenToggle,
  };
}
