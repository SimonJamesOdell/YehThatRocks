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
 * Dispatches OVERLAY_CLOSE_REQUEST with the target video href.
 * The close handler applies the same 520ms favouritesBlindLift
 * CSS animation used by all other overlays before navigating.
 */
export function MagazineWatchCta({ videoId, artist, className }: MagazineWatchCtaProps) {
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      dispatchAppEvent(EVENT_NAMES.OVERLAY_CLOSE_REQUEST, {
        href: `/?v=${encodeURIComponent(videoId)}&resume=1`,
      });
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
