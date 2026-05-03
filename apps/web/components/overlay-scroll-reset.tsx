"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useOverlayScrollContainerRef } from "@/components/overlay-scroll-container-context";

export function OverlayScrollReset() {
  const pathname = usePathname();
  const overlayScrollContainerRef = useOverlayScrollContainerRef();

  useEffect(() => {
    // Reset both page and overlay scroll so every overlay always opens from the top.
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });

    const overlay = overlayScrollContainerRef?.current;
    if (overlay) {
      overlay.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, [overlayScrollContainerRef, pathname]);

  return null;
}
