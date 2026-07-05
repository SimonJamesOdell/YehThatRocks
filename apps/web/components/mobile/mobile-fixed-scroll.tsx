"use client";

import { useEffect, type ReactNode } from "react";

const FIXED_CLASS = "mobile-fixed-scroll";

/**
 * Sets a class on <html> to lock body-level scrolling and restructure
 * the mobile shell for internal results-contained scrolling.
 *
 * Renders its children inside a flex-column that fills .mobile-content.
 */
export function MobileFixedScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add(FIXED_CLASS);
    return () => {
      document.documentElement.classList.remove(FIXED_CLASS);
    };
  }, []);

  return (
    <div className="mobile-fixed-page">
      {children}
    </div>
  );
}
