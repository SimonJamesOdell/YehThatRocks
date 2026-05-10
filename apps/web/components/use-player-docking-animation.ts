import { useEffect, useRef, type RefObject } from "react";

const FOOTER_REVEAL_DURATION_MS = 340;
const UNDOCK_SETTLE_DURATION_MS = 320;

type UsePlayerDockingAnimationOptions = {
  shouldShowOverlayPanel: boolean;
  onSetIsUndockSettling: (value: boolean) => void;
  onSetIsFooterRevealActive: (value: boolean) => void;
};

export function usePlayerDockingAnimation({
  shouldShowOverlayPanel,
  onSetIsUndockSettling,
  onSetIsFooterRevealActive,
}: UsePlayerDockingAnimationOptions): {
  playerChromeRef: RefObject<HTMLDivElement | null>;
} {
  const playerChromeRef = useRef<HTMLDivElement | null>(null);
  const undockSettleTimeoutRef = useRef<number | null>(null);
  const footerRevealTimeoutRef = useRef<number | null>(null);
  const footerRevealEarlyTimeoutRef = useRef<number | null>(null);
  const shouldRunFooterRevealRef = useRef(false);
  const earlyFooterRevealFiredRef = useRef(false);

  useEffect(() => {
    if (!shouldShowOverlayPanel) {
      shouldRunFooterRevealRef.current = false;
      return;
    }

    shouldRunFooterRevealRef.current = true;

    // Measure the current height and lock it before state is flushed to prevent
    // the height transition from expanding the container, which would otherwise
    // cause a visible reflow.
    const chrome = playerChromeRef.current;
    if (chrome) {
      const lockedHeight = chrome.getBoundingClientRect().height;
      chrome.style.height = `${lockedHeight}px`;
    }

    if (typeof window !== "undefined") {
      if (undockSettleTimeoutRef.current !== null) {
        window.clearTimeout(undockSettleTimeoutRef.current);
      }
      if (footerRevealTimeoutRef.current !== null) {
        window.clearTimeout(footerRevealTimeoutRef.current);
        footerRevealTimeoutRef.current = null;
      }

      undockSettleTimeoutRef.current = window.setTimeout(() => {
        onSetIsUndockSettling(false);
        undockSettleTimeoutRef.current = null;

        if (earlyFooterRevealFiredRef.current) {
          // Early reveal already ran during the movement animation — the footer
          // animation has completed. Just release the height lock.
          earlyFooterRevealFiredRef.current = false;
          onSetIsFooterRevealActive(false);
          if (chrome) {
            chrome.style.height = "";
          }
        } else {
          // Fallback: early reveal timer was cancelled or didn't fire (e.g. the
          // overlay was closed very quickly). Trigger the reveal now.
          onSetIsFooterRevealActive(true);
          footerRevealTimeoutRef.current = window.setTimeout(() => {
            onSetIsFooterRevealActive(false);
            footerRevealTimeoutRef.current = null;
            // Release the height lock after the footer has fully faded in.
            if (chrome) {
              chrome.style.height = "";
            }
          }, FOOTER_REVEAL_DURATION_MS);
        }
      }, UNDOCK_SETTLE_DURATION_MS);
    }
  }, [shouldShowOverlayPanel, onSetIsUndockSettling, onSetIsFooterRevealActive]);

  return { playerChromeRef };
}
