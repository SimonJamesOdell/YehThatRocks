"use client";

import { useCallback } from "react";

import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";

type MagazineWatchCtaProps = {
  videoId: string;
  artist?: string;
  className?: string;
};

/**
 * "Watch Now in YehThatRocks" button for magazine articles.
 *
 * Dispatches OVERLAY_CLOSE_REQUEST to close the magazine overlay and navigate
 * to the root page with the target video, using the same client-side navigation
 * mechanism as the CloseLink in the overlay header. This avoids a full page
 * reload while correctly triggering the shell's requestedVideoId resolution.
 */
export function MagazineWatchCta({ videoId, artist, className }: MagazineWatchCtaProps) {
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const closeHref = `/?v=${encodeURIComponent(videoId)}&resume=1`;
      dispatchAppEvent(EVENT_NAMES.OVERLAY_CLOSE_REQUEST, { href: closeHref });
    },
    [videoId],
  );

  const label = artist ? "Watch now in YehThatRocks" : "Watch Now";

  return (
    <button
      type="button"
      className={className ?? "magazineWatchCta"}
      onClick={handleClick}
    >
      {label}
    </button>
  );
}
