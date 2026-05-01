"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

// ── Constants ──────────────────────────────────────────────────────────────

export const DESKTOP_INTRO_LOGO_SRC = "/assets/images/yeh_main_logo.png?v=20260424-4";

const DESKTOP_INTRO_HOLD_MS = 1300;
const DESKTOP_INTRO_MOVE_MS = 760;
const DESKTOP_INTRO_REVEAL_MS = 820;
const DESKTOP_INTRO_MAX_LOGO_WIDTH_PX = 1128;
const DESKTOP_INTRO_VIEWPORT_WIDTH_RATIO = 1.128;

// ── Types ──────────────────────────────────────────────────────────────────

export type DesktopIntroPhase = "disabled" | "hold" | "moving" | "revealing" | "done";

export type DesktopIntroState = {
  /** True while the logo image is being preloaded before the sequence fires. */
  isDesktopIntroPreload: boolean;
  /** True once the logo image has finished loading/decoding. */
  isDesktopIntroLogoReady: boolean;
  /** Current animation phase. */
  desktopIntroPhase: DesktopIntroPhase;
  /** True during hold / moving / revealing phases. */
  isDesktopIntroActive: boolean;
  /** CSS transform delta (px) from viewport centre to brand logo. */
  desktopIntroDeltaX: number;
  desktopIntroDeltaY: number;
  /** CSS scale applied to the intro logo overlay. */
  desktopIntroScale: number;
  /** Ref attached to the brand-logo <a> element for position measurement. */
  brandLogoTargetRef: React.RefObject<HTMLAnchorElement | null>;
  /**
   * Inline style object for the shell element carrying the intro CSS
   * variables. Undefined when the intro is not active.
   */
  shellDesktopIntroStyle: CSSProperties | undefined;
  /**
   * Trigger the full prepared intro sequence (preload + animate).
   * Call this from the brand-logo click handler.
   */
  startPreparedDesktopIntroSequence: () => Promise<void>;
  /**
   * Write true here before navigating home so that the next "/" render
   * replays the intro. The hook resets the ref automatically once consumed.
   */
  shouldReplayDesktopIntroOnHomeRef: React.MutableRefObject<boolean>;
};

// ── Hook ───────────────────────────────────────────────────────────────────

export function useDesktopIntro({
  pathname,
}: {
  pathname: string;
}): DesktopIntroState {
  const [isDesktopIntroPreload, setIsDesktopIntroPreload] = useState(true);
  const [isDesktopIntroLogoReady, setIsDesktopIntroLogoReady] = useState(false);
  const [desktopIntroPhase, setDesktopIntroPhase] = useState<DesktopIntroPhase>("disabled");
  const [desktopIntroDeltaX, setDesktopIntroDeltaX] = useState(0);
  const [desktopIntroDeltaY, setDesktopIntroDeltaY] = useState(0);
  const [desktopIntroScale, setDesktopIntroScale] = useState(1);

  const brandLogoTargetRef = useRef<HTMLAnchorElement | null>(null);
  const desktopIntroHoldTimeoutRef = useRef<number | null>(null);
  const desktopIntroMoveTimeoutRef = useRef<number | null>(null);
  const desktopIntroRevealTimeoutRef = useRef<number | null>(null);
  const desktopIntroMeasureRafRef = useRef<number | null>(null);
  const desktopIntroPhaseRef = useRef<DesktopIntroPhase>("disabled");
  const desktopIntroLogoLoadIdRef = useRef(0);
  const shouldReplayDesktopIntroOnHomeRef = useRef(false);

  const isDesktopIntroActive =
    desktopIntroPhase === "hold"
    || desktopIntroPhase === "moving"
    || desktopIntroPhase === "revealing";

  // Keep the phase ref in sync for use inside resize handlers.
  useEffect(() => {
    desktopIntroPhaseRef.current = desktopIntroPhase;
  }, [desktopIntroPhase]);

  const clearDesktopIntroTimers = useCallback(() => {
    if (desktopIntroHoldTimeoutRef.current !== null) {
      window.clearTimeout(desktopIntroHoldTimeoutRef.current);
      desktopIntroHoldTimeoutRef.current = null;
    }

    if (desktopIntroMoveTimeoutRef.current !== null) {
      window.clearTimeout(desktopIntroMoveTimeoutRef.current);
      desktopIntroMoveTimeoutRef.current = null;
    }

    if (desktopIntroRevealTimeoutRef.current !== null) {
      window.clearTimeout(desktopIntroRevealTimeoutRef.current);
      desktopIntroRevealTimeoutRef.current = null;
    }

    if (desktopIntroMeasureRafRef.current !== null) {
      window.cancelAnimationFrame(desktopIntroMeasureRafRef.current);
      desktopIntroMeasureRafRef.current = null;
    }
  }, []);

  const syncDesktopIntroTarget = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const target = brandLogoTargetRef.current;
    if (!target) {
      return;
    }

    const logoImage = target.querySelector("img.brandLogo");
    const rect = (logoImage ?? target).getBoundingClientRect();
    const viewportCenterX = window.innerWidth / 2;
    const viewportCenterY = window.innerHeight / 2;
    const targetCenterX = rect.left + rect.width / 2;
    const targetCenterY = rect.top + rect.height / 2;
    const introStartWidth = Math.min(window.innerWidth * DESKTOP_INTRO_VIEWPORT_WIDTH_RATIO, DESKTOP_INTRO_MAX_LOGO_WIDTH_PX);
    const targetScale = Math.max(0.3, Math.min(1.2, rect.width / introStartWidth));

    setDesktopIntroDeltaX(targetCenterX - viewportCenterX);
    setDesktopIntroDeltaY(targetCenterY - viewportCenterY);
    setDesktopIntroScale(targetScale);
  }, []);

  const startDesktopIntroSequence = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const isDesktop = window.matchMedia("(min-width: 1181px)").matches;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!isDesktop || prefersReducedMotion) {
      setDesktopIntroPhase("disabled");
      setIsDesktopIntroPreload(false);
      return;
    }

    clearDesktopIntroTimers();
    setDesktopIntroDeltaX(0);
    setDesktopIntroDeltaY(0);
    setDesktopIntroScale(1);
    setDesktopIntroPhase("hold");
    setIsDesktopIntroPreload(false);

    desktopIntroMeasureRafRef.current = window.requestAnimationFrame(() => {
      syncDesktopIntroTarget();
      desktopIntroMeasureRafRef.current = null;
    });

    desktopIntroHoldTimeoutRef.current = window.setTimeout(() => {
      syncDesktopIntroTarget();
      setDesktopIntroPhase("moving");

      desktopIntroMoveTimeoutRef.current = window.setTimeout(() => {
        setDesktopIntroPhase("revealing");
        desktopIntroMoveTimeoutRef.current = null;

        desktopIntroRevealTimeoutRef.current = window.setTimeout(() => {
          setDesktopIntroPhase("done");
          desktopIntroRevealTimeoutRef.current = null;
        }, DESKTOP_INTRO_REVEAL_MS);
      }, DESKTOP_INTRO_MOVE_MS);
    }, DESKTOP_INTRO_HOLD_MS);
  }, [clearDesktopIntroTimers, syncDesktopIntroTarget]);

  const prepareDesktopIntroLogo = useCallback(async () => {
    if (typeof window === "undefined") {
      return false;
    }

    const loadId = desktopIntroLogoLoadIdRef.current + 1;
    desktopIntroLogoLoadIdRef.current = loadId;
    setIsDesktopIntroLogoReady(false);

    const image = new window.Image();
    image.decoding = "async";
    image.src = DESKTOP_INTRO_LOGO_SRC;

    const finalizeReady = () => {
      if (desktopIntroLogoLoadIdRef.current !== loadId) {
        return false;
      }

      setIsDesktopIntroLogoReady(true);
      return true;
    };

    if (image.complete) {
      if (typeof image.decode === "function") {
        try {
          await image.decode();
        } catch {
          // Fall back to the completed image state if decode rejects.
        }
      }

      return finalizeReady();
    }

    return await new Promise<boolean>((resolve) => {
      const handleLoad = () => {
        cleanup();
        finalizeReady();
        resolve(true);
      };

      const handleError = () => {
        cleanup();
        finalizeReady();
        resolve(false);
      };

      const cleanup = () => {
        image.removeEventListener("load", handleLoad);
        image.removeEventListener("error", handleError);
      };

      image.addEventListener("load", handleLoad, { once: true });
      image.addEventListener("error", handleError, { once: true });
    });
  }, []);

  const startPreparedDesktopIntroSequence = useCallback(async () => {
    setIsDesktopIntroPreload(true);
    const ready = await prepareDesktopIntroLogo();

    if (!ready) {
      setIsDesktopIntroPreload(false);
    }

    startDesktopIntroSequence();
  }, [prepareDesktopIntroLogo, startDesktopIntroSequence]);

  // Run the intro on first mount and re-run on resize while active.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    void startPreparedDesktopIntroSequence();

    const handleResize = () => {
      const phase = desktopIntroPhaseRef.current;
      if (phase === "hold" || phase === "moving") {
        syncDesktopIntroTarget();
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      clearDesktopIntroTimers();
    };
  }, [clearDesktopIntroTimers, startPreparedDesktopIntroSequence, syncDesktopIntroTarget]);

  // Replay the intro when the user navigates back to "/" via the brand logo.
  useEffect(() => {
    if (pathname !== "/" || !shouldReplayDesktopIntroOnHomeRef.current) {
      return;
    }

    shouldReplayDesktopIntroOnHomeRef.current = false;
    void startPreparedDesktopIntroSequence();
  }, [pathname, startPreparedDesktopIntroSequence]);

  const shellDesktopIntroStyle: CSSProperties | undefined = isDesktopIntroActive
    ? {
      "--desktop-intro-dx": `${desktopIntroDeltaX}px`,
      "--desktop-intro-dy": `${desktopIntroDeltaY}px`,
      "--desktop-intro-scale": String(desktopIntroScale),
    } as CSSProperties
    : undefined;

  return {
    isDesktopIntroPreload,
    isDesktopIntroLogoReady,
    desktopIntroPhase,
    isDesktopIntroActive,
    desktopIntroDeltaX,
    desktopIntroDeltaY,
    desktopIntroScale,
    brandLogoTargetRef,
    shellDesktopIntroStyle,
    startPreparedDesktopIntroSequence,
    shouldReplayDesktopIntroOnHomeRef,
  };
}
