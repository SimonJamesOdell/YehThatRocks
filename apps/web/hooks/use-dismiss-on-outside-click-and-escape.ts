"use client";

import { useEffect, type RefObject } from "react";

export function useDismissOnOutsideClickAndEscape({
  isOpen,
  containerRef,
  onDismiss,
}: {
  isOpen: boolean;
  containerRef: RefObject<HTMLElement | null>;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      if (event.target instanceof Node && !container.contains(event.target)) {
        onDismiss();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };

    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [containerRef, isOpen, onDismiss]);
}
