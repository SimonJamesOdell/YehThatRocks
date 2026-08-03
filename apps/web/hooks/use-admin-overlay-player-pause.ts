"use client";

import { useEffect } from "react";

/**
 * Pauses any playing YouTube embeds when the admin overlay route is active
 * so audio does not leak through the overlay.  The admin route covers the
 * player visually but the iframe can still produce sound.
 *
 * Uses a MutationObserver to catch late-loading iframes (e.g. initial page
 * load where the YouTube API hasn't injected the player yet).
 */
export function useAdminOverlayPlayerPause(isAdminOverlayRoute: boolean) {
  useEffect(() => {
    if (typeof window === "undefined" || !isAdminOverlayRoute) {
      return;
    }
    const pauseYouTubeIframes = () => {
      const iframes = document.querySelectorAll<HTMLIFrameElement>(
        'iframe[src*="youtube.com/embed/"]',
      );
      iframes.forEach((iframe) => {
        try {
          iframe.contentWindow?.postMessage(
            JSON.stringify({ event: "command", func: "pauseVideo", args: [] }),
            "*",
          );
        } catch {
          // Cross-origin or destroyed iframe — safe to ignore.
        }
      });
    };

    // Run immediately for already-loaded players.
    pauseYouTubeIframes();

    // Watch for late-loading YouTube iframes.
    const observer = new MutationObserver(() => {
      pauseYouTubeIframes();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
    };
  }, [isAdminOverlayRoute]);
}