"use client";

import { useEffect, useRef } from "react";

import type { VideoRecord } from "@/lib/catalog";
import { SHARE_SITE_NAME } from "@/lib/share-metadata";

/**
 * Keeps the browser-tab title in sync with the currently playing video.
 *
 * Native `history.pushState` navigations (used by /new, /top100, search and
 * docked-route next/prev) never re-run the server `generateMetadata`, so the
 * tab title would otherwise stay stale.
 *
 * We write on the initial mount as well as on every video change. The server
 * `generateMetadata` and the shell layout resolve the requested video with
 * different options (the layout uses `skipPlaybackDecision` and falls back to a
 * random video when the requested id can't be resolved), so the server-rendered
 * `<title>` can describe a different track than the video that is actually
 * playing. Deriving the title from `currentVideo` here guarantees the tab always
 * matches the player, including when a fallback or a differently-resolved video
 * ends up playing.
 */
export function useVideoPageTitle(currentVideo: VideoRecord) {
  const lastTitledVideoIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const videoTitle = currentVideo.title.trim();
    if (!videoTitle) {
      return;
    }
    if (lastTitledVideoIdRef.current === currentVideo.id) {
      return;
    }
    lastTitledVideoIdRef.current = currentVideo.id;
    document.title = `${videoTitle} | ${SHARE_SITE_NAME}`;
  }, [currentVideo]);
}
