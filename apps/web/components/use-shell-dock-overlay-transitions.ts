"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

type OverlayOpenKind = "wiki" | "video" | null;

type UseShellDockOverlayTransitionsParams = {
  currentVideoId: string;
  isMagazineOverlayRoute: boolean;
  pathname: string;
  requestedVideoId: string | null;
  shouldShowOverlayPanel: boolean;
  shouldDockDesktopPlayer: boolean;
  shouldDockUnderArtistsAlphabet: boolean;
  playerChromeRef: RefObject<HTMLElement | null>;
  setPendingOverlayOpenKind: (kind: OverlayOpenKind) => void;
  setPendingOverlayCloseVideoId: (videoId: string | null) => void;
  setPendingOverlayCloseHref: (href: string | null) => void;
  onPush: (href: string) => void;
  onOverlayShown?: () => void;
  dockMoveDurationMs: number;
  footerRevealDurationMs: number;
  footerEarlyRevealDelayMs: number;
  dockControlsFadeDelayMs: number;
};

export function useShellDockOverlayTransitions({
  currentVideoId,
  isMagazineOverlayRoute,
  pathname,
  requestedVideoId,
  shouldShowOverlayPanel,
  shouldDockDesktopPlayer,
  shouldDockUnderArtistsAlphabet,
  playerChromeRef,
  setPendingOverlayOpenKind,
  setPendingOverlayCloseVideoId,
  setPendingOverlayCloseHref,
  onPush,
  onOverlayShown,
  dockMoveDurationMs,
  footerRevealDurationMs,
  footerEarlyRevealDelayMs,
  dockControlsFadeDelayMs,
}: UseShellDockOverlayTransitionsParams) {
  const [isOverlayClosing, setIsOverlayClosing] = useState(false);
  const [isUndockSettling, setIsUndockSettling] = useState(false);
  const [isFooterRevealActive, setIsFooterRevealActive] = useState(false);
  const [isDockTransitioning, setIsDockTransitioning] = useState(false);
  const [isDockHidden, setIsDockHidden] = useState(false);

  const overlayCloseTimeoutRef = useRef<number | null>(null);
  const footerRevealTimeoutRef = useRef<number | null>(null);
  const footerRevealEarlyTimeoutRef = useRef<number | null>(null);
  const undockSettleTimeoutRef = useRef<number | null>(null);
  const shouldRunFooterRevealRef = useRef(false);
  const earlyFooterRevealFiredRef = useRef(false);
  const dockTransitionTimeoutRef = useRef<number | null>(null);

  const handleOverlayCloseRequest = useCallback((href: string) => {
    const closeUrl = new URL(href, window.location.origin);
    const fallbackHomeHref = `/?v=${encodeURIComponent(currentVideoId)}&resume=1`;
    const nextHref = closeUrl.pathname === "/" && closeUrl.searchParams.has("v")
      ? `${closeUrl.pathname}${closeUrl.search}${closeUrl.hash}`
      : fallbackHomeHref;

    const targetVideoId = closeUrl.pathname === "/" ? closeUrl.searchParams.get("v") : null;
    const shouldHoldOverlayForVideoSwitch = Boolean(targetVideoId && targetVideoId !== currentVideoId);

    if (shouldHoldOverlayForVideoSwitch && targetVideoId) {
      setPendingOverlayOpenKind("video");
      setPendingOverlayCloseVideoId(targetVideoId);
      setPendingOverlayCloseHref(nextHref);
    } else {
      setPendingOverlayCloseVideoId(null);
      setPendingOverlayCloseHref(null);
    }

    if (!shouldShowOverlayPanel || isMagazineOverlayRoute) {
      setIsOverlayClosing(false);
      shouldRunFooterRevealRef.current = false;
      setIsUndockSettling(false);
      setIsFooterRevealActive(false);
      onPush(nextHref);
      return;
    }

    if (overlayCloseTimeoutRef.current !== null) {
      window.clearTimeout(overlayCloseTimeoutRef.current);
      overlayCloseTimeoutRef.current = null;
    }

    setIsOverlayClosing(true);
    shouldRunFooterRevealRef.current = true;
    earlyFooterRevealFiredRef.current = false;

    const shouldNavigateDuringCloseAnimation = pathname === "/new" && shouldHoldOverlayForVideoSwitch;

    if (footerRevealEarlyTimeoutRef.current !== null) {
      window.clearTimeout(footerRevealEarlyTimeoutRef.current);
    }

    footerRevealEarlyTimeoutRef.current = window.setTimeout(() => {
      footerRevealEarlyTimeoutRef.current = null;
      earlyFooterRevealFiredRef.current = true;
      setIsFooterRevealActive(true);

      if (footerRevealTimeoutRef.current !== null) {
        window.clearTimeout(footerRevealTimeoutRef.current);
      }

      footerRevealTimeoutRef.current = window.setTimeout(() => {
        setIsFooterRevealActive(false);
        footerRevealTimeoutRef.current = null;
      }, footerRevealDurationMs);
    }, footerEarlyRevealDelayMs);

    const frame = playerChromeRef.current?.querySelector(".playerFrame, .playerLoadingFallback") as HTMLElement | null;
    let didNavigate = false;

    const finishCloseNavigation = () => {
      if (didNavigate) {
        return;
      }
      didNavigate = true;
      if (overlayCloseTimeoutRef.current !== null) {
        window.clearTimeout(overlayCloseTimeoutRef.current);
        overlayCloseTimeoutRef.current = null;
      }
      onPush(nextHref);
    };

    if (shouldNavigateDuringCloseAnimation) {
      finishCloseNavigation();
      return;
    }

    const handleFrameTransitionEnd = (transitionEvent: TransitionEvent) => {
      if (transitionEvent.propertyName !== "transform") {
        return;
      }
      if (frame && transitionEvent.target !== frame) {
        return;
      }
      frame?.removeEventListener("transitionend", handleFrameTransitionEnd);
      finishCloseNavigation();
    };

    frame?.addEventListener("transitionend", handleFrameTransitionEnd);
    overlayCloseTimeoutRef.current = window.setTimeout(() => {
      frame?.removeEventListener("transitionend", handleFrameTransitionEnd);
      finishCloseNavigation();
    }, dockMoveDurationMs + 120);
  }, [
    currentVideoId,
    dockMoveDurationMs,
    footerEarlyRevealDelayMs,
    footerRevealDurationMs,
    isMagazineOverlayRoute,
    onPush,
    pathname,
    playerChromeRef,
    setPendingOverlayCloseHref,
    setPendingOverlayCloseVideoId,
    setPendingOverlayOpenKind,
    shouldShowOverlayPanel,
  ]);

  const handleDockHideRequest = useCallback(() => {
    setIsDockHidden(true);
  }, []);

  useEffect(() => {
    if (!shouldShowOverlayPanel && isOverlayClosing) {
      setIsOverlayClosing(false);
    }
  }, [isOverlayClosing, shouldShowOverlayPanel]);

  useEffect(() => {
    if (!shouldShowOverlayPanel) {
      return;
    }

    if (typeof window !== "undefined" && undockSettleTimeoutRef.current !== null) {
      window.clearTimeout(undockSettleTimeoutRef.current);
      undockSettleTimeoutRef.current = null;
    }
    if (typeof window !== "undefined" && footerRevealTimeoutRef.current !== null) {
      window.clearTimeout(footerRevealTimeoutRef.current);
      footerRevealTimeoutRef.current = null;
    }
    if (typeof window !== "undefined" && footerRevealEarlyTimeoutRef.current !== null) {
      window.clearTimeout(footerRevealEarlyTimeoutRef.current);
      footerRevealEarlyTimeoutRef.current = null;
    }

    if (playerChromeRef.current) {
      playerChromeRef.current.style.height = "";
    }

    setIsUndockSettling(false);
    setIsFooterRevealActive(false);
    earlyFooterRevealFiredRef.current = false;
    onOverlayShown?.();
  }, [onOverlayShown, playerChromeRef, shouldShowOverlayPanel]);

  useEffect(() => {
    return () => {
      if (overlayCloseTimeoutRef.current !== null) {
        window.clearTimeout(overlayCloseTimeoutRef.current);
        overlayCloseTimeoutRef.current = null;
      }
      if (footerRevealTimeoutRef.current !== null) {
        window.clearTimeout(footerRevealTimeoutRef.current);
        footerRevealTimeoutRef.current = null;
      }
      if (footerRevealEarlyTimeoutRef.current !== null) {
        window.clearTimeout(footerRevealEarlyTimeoutRef.current);
        footerRevealEarlyTimeoutRef.current = null;
      }
      if (undockSettleTimeoutRef.current !== null) {
        window.clearTimeout(undockSettleTimeoutRef.current);
        undockSettleTimeoutRef.current = null;
      }
      setIsUndockSettling(false);
      shouldRunFooterRevealRef.current = false;
      earlyFooterRevealFiredRef.current = false;
    };
  }, [currentVideoId, isMagazineOverlayRoute, pathname, shouldShowOverlayPanel]);

  useEffect(() => {
    if (requestedVideoId) {
      setIsDockHidden(false);
    }
  }, [requestedVideoId]);

  useEffect(() => {
    if (shouldDockDesktopPlayer) {
      setIsDockHidden(false);
    }
  }, [pathname, shouldDockDesktopPlayer]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (dockTransitionTimeoutRef.current !== null) {
      window.clearTimeout(dockTransitionTimeoutRef.current);
      dockTransitionTimeoutRef.current = null;
    }

    if (!shouldDockDesktopPlayer) {
      setIsDockTransitioning(false);
      setIsDockHidden(false);
      return;
    }

    setIsDockTransitioning(true);
    dockTransitionTimeoutRef.current = window.setTimeout(() => {
      setIsDockTransitioning(false);
      dockTransitionTimeoutRef.current = null;
    }, dockControlsFadeDelayMs);

    return () => {
      if (dockTransitionTimeoutRef.current !== null) {
        window.clearTimeout(dockTransitionTimeoutRef.current);
        dockTransitionTimeoutRef.current = null;
      }
    };
  }, [dockControlsFadeDelayMs, shouldDockDesktopPlayer, shouldDockUnderArtistsAlphabet]);

  return {
    isOverlayClosing,
    isUndockSettling,
    isFooterRevealActive,
    isDockTransitioning,
    isDockHidden,
    setIsUndockSettling,
    setIsFooterRevealActive,
    handleOverlayCloseRequest,
    handleDockHideRequest,
  };
}
