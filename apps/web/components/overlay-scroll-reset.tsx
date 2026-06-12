"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useOverlayScrollContainerRef } from "@/components/overlay-scroll-container-context";

type OverlayScrollResetProps = {
  /** When an active video is present, the auto-scroll hook handles positioning —
   *  skip the reset-to-top to avoid fighting with it. */
  activeVideoId?: string | null;
};

export function OverlayScrollReset({ activeVideoId }: OverlayScrollResetProps = {}) {
  const pathname = usePathname();
  const overlayScrollContainerRef = useOverlayScrollContainerRef();

  useEffect(() => {
    // When an active track is being targeted, the useActiveRowAutoScroll hook
    // will scroll it into view — don't fight it with a reset-to-top.
    if (activeVideoId) {
      return;
    }

    window.scrollTo({ top: 0, left: 0, behavior: "auto" });

    const overlay = overlayScrollContainerRef?.current;
    if (overlay) {
      overlay.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, [activeVideoId, overlayScrollContainerRef, pathname]);

  return null;
}
