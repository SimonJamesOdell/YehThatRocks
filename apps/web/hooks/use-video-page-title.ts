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
 * playing.
 *
 * The player always loads the `?v=` id directly from the URL, so when the
 * layout has fallen back to a random video, `currentVideo` describes the
 * fallback rather than the video actually playing. Writing the title from
 * `currentVideo` in that state would stamp another track's name into the tab
 * (most visible when a video link is opened in a new tab). We therefore only
 * sync the title from `currentVideo` once it matches the explicitly requested
 * `?v=` id; until then the server-rendered `<title>` (which already describes
 * the requested video) is preserved.
 */
export function useVideoPageTitle(
  currentVideo: VideoRecord,
  requestedVideoId: string | null,
) {
  const lastTitledVideoIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const videoTitle = currentVideo.title.trim();
    if (!videoTitle) {
      return;
    }
    // When the URL explicitly requests a video, the player loads that id
    // directly from the URL while the shell layout may have resolved a random
    // fallback for `currentVideo`. Writing the fallback's title here would
    // stamp another track's name into the tab (most visible when a video link
    // is opened in a new tab). Preserve the server-rendered title until
    // `currentVideo` actually catches up to the requested id.
    if (requestedVideoId && currentVideo.id !== requestedVideoId) {
      return;
    }
    if (lastTitledVideoIdRef.current === currentVideo.id) {
      return;
    }
    lastTitledVideoIdRef.current = currentVideo.id;
    document.title = `${videoTitle} | ${SHARE_SITE_NAME}`;
  }, [currentVideo, requestedVideoId]);
}
