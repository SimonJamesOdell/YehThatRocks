"use client";

import { useEffect, useRef } from "react";

import type { VideoRecord } from "@/lib/catalog";
import { SHARE_SITE_NAME } from "@/lib/share-metadata";

/**
 * Keeps the browser-tab title in sync with the currently playing video.
 *
 * Native `history.pushState` navigations (used by /new, /top100, search and
 * docked-route next/prev) never re-run the server `generateMetadata`, so the
 * tab title would otherwise stay stale. We only write on actual video changes —
 * the ref is initialised to the SSR video so landing titles are preserved.
 */
export function useVideoPageTitle(currentVideo: VideoRecord) {
  const lastTitledVideoIdRef = useRef<string | null>(currentVideo.id);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    if (lastTitledVideoIdRef.current === currentVideo.id) {
      return;
    }
    lastTitledVideoIdRef.current = currentVideo.id;
    const videoTitle = currentVideo.title.trim();
    if (!videoTitle) {
      return;
    }
    document.title = `${videoTitle} | ${SHARE_SITE_NAME}`;
  }, [currentVideo]);
}
