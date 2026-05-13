"use client";

import { useCallback, type MutableRefObject } from "react";

type PlaylistDropAnimation = {
  key: number;
  thumbnailUrl: string;
  fromX: number;
  fromY: number;
  deltaX: number;
  deltaY: number;
  fromWidth: number;
  fromHeight: number;
  scale: number;
};

export function usePlaylistDropAnimation({
  playerFrameRef,
  currentVideoId,
  playlistDropAnimationTimeoutRef,
  setPlaylistDropAnimation,
}: {
  playerFrameRef: MutableRefObject<HTMLDivElement | null>;
  currentVideoId: string;
  playlistDropAnimationTimeoutRef: MutableRefObject<number | null>;
  setPlaylistDropAnimation: (value: PlaylistDropAnimation | null) => void;
}) {
  const triggerPlaylistDropAnimation = useCallback(() => {
    if (typeof document === "undefined") {
      return;
    }

    const sourceRect = playerFrameRef.current?.getBoundingClientRect();
    const sourceWidth = sourceRect?.width ?? window.innerWidth * 0.56;
    const sourceHeight = sourceRect?.height ?? window.innerHeight * 0.4;
    const fromX = sourceRect ? sourceRect.left + sourceRect.width * 0.5 : window.innerWidth * 0.5;
    const fromY = sourceRect ? sourceRect.top + sourceRect.height * 0.5 : window.innerHeight * 0.45;

    const playlistTarget = document.querySelector(
      ".relatedStackPlaylistBody, .rightRailPlaylistBar, .rightRailTabs .activeTab, .rightRailTabs button:nth-child(2), .rightRail",
    ) as HTMLElement | null;
    const targetRect = playlistTarget?.getBoundingClientRect();
    const toX = targetRect ? targetRect.left + Math.min(120, Math.max(42, targetRect.width * 0.28)) : window.innerWidth * 0.84;
    const toY = targetRect ? targetRect.top + Math.min(84, Math.max(34, targetRect.height * 0.24)) : window.innerHeight * 0.24;

    const maxStartHeight = sourceRect ? sourceRect.height * 0.92 : window.innerHeight * 0.54;
    let fromWidth = sourceRect ? sourceRect.width * 0.9 : window.innerWidth * 0.68;
    let fromHeight = (fromWidth * 9) / 16;
    if (fromHeight > maxStartHeight) {
      fromHeight = maxStartHeight;
      fromWidth = (fromHeight * 16) / 9;
    }
    fromWidth = Math.max(320, Math.min(fromWidth, window.innerWidth * 0.9));
    fromHeight = Math.round((fromWidth * 9) / 16);
    const targetWidth = 76;
    const scale = targetWidth / fromWidth;

    setPlaylistDropAnimation({
      key: Date.now(),
      thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(currentVideoId)}/mqdefault.jpg`,
      fromX,
      fromY,
      deltaX: toX - fromX,
      deltaY: toY - fromY,
      fromWidth,
      fromHeight,
      scale,
    });

    if (playlistDropAnimationTimeoutRef.current !== null) {
      window.clearTimeout(playlistDropAnimationTimeoutRef.current);
    }
    playlistDropAnimationTimeoutRef.current = window.setTimeout(() => {
      setPlaylistDropAnimation(null);
      playlistDropAnimationTimeoutRef.current = null;
    }, 620);
  }, [currentVideoId, playerFrameRef, playlistDropAnimationTimeoutRef, setPlaylistDropAnimation]);

  return {
    triggerPlaylistDropAnimation,
  };
}
