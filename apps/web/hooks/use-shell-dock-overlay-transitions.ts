"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePlayerDockingAnimation } from "@/hooks/use-player-docking-animation";

type OverlayOpenKind = "wiki" | "video" | null;

type UseShellDockOverlayTransitionsParams = {
  isOverlayClosing: boolean;
  setIsOverlayClosing: (value: boolean) => void;
  isUndockSettling: boolean;
  setIsUndockSettling: (value: boolean) => void;
  setIsFooterRevealActive: (value: boolean) => void;
  currentVideoId: string;
  isMagazineOverlayRoute: boolean;
  pathname: string;
  requestedVideoId: string | null;
  shouldShowOverlayPanel: boolean;
  setPendingOverlayOpenKind: (kind: OverlayOpenKind) => void;
  setPendingOverlayCloseVideoId: (videoId: string | null) => void;
  setPendingOverlayCloseHref: (href: string | null) => void;
  onPush: (href: string) => void;
  onOverlayShown?: () => void;
  dockMoveDurationMs: number;
  footerRevealDurationMs: number;
  footerEarlyRevealDelayMs: number;
};

export function useShellDockOverlayTransitions({
  isOverlayClosing,
  setIsOverlayClosing,
  isUndockSettling,
  setIsUndockSettling,
  setIsFooterRevealActive,
  currentVideoId,
  isMagazineOverlayRoute,
  pathname,
  requestedVideoId,
  shouldShowOverlayPanel,
  setPendingOverlayOpenKind,
  setPendingOverlayCloseVideoId,
  setPendingOverlayCloseHref,
  onPush,
  onOverlayShown,
  dockMoveDurationMs,
  footerRevealDurationMs,
  footerEarlyRevealDelayMs,
}: UseShellDockOverlayTransitionsParams) {
  const { playerChromeRef } = usePlayerDockingAnimation({
    shouldShowOverlayPanel,
    onSetIsUndockSettling: setIsUndockSettling,
    onSetIsFooterRevealActive: setIsFooterRevealActive,
  });

  const overlayCloseTimeoutRef = useRef<number | null>(null);
  const footerRevealTimeoutRef = useRef<number | null>(null);
  const footerRevealEarlyTimeoutRef = useRef<number | null>(null);
  const undockSettleTimeoutRef = useRef<number | null>(null);
  const shouldRunFooterRevealRef = useRef(false);
  const earlyFooterRevealFiredRef = useRef(false);

  const handleOverlayCloseRequest = useCallback((href: string) => {
    const closeUrl = new URL(href, window.location.origin);
    const fallbackHomeHref = `/?v=${encodeURIComponent(currentVideoId)}&resume=1`;
    const isRootVideoCloseTarget = closeUrl.pathname === "/" && closeUrl.searchParams.has("v");
    const isNewPageCloseTarget = closeUrl.pathname === "/new";
    const isTop100PageCloseTarget = closeUrl.pathname === "/top100";
    const isFavouritesPageCloseTarget = closeUrl.pathname === "/favourites";
    const isOverlayToOverlayCloseTarget = closeUrl.pathname !== "/";
    const nextHref = isRootVideoCloseTarget || isNewPageCloseTarget || isTop100PageCloseTarget || isFavouritesPageCloseTarget
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

    if (!shouldShowOverlayPanel) {
      setIsOverlayClosing(false);
      shouldRunFooterRevealRef.current = false;
      setIsUndockSettling(false);
      setIsFooterRevealActive(false);
      onPush(nextHref);
      return;
    }

    // Magazine overlays: navigate first so the video starts loading
    // immediately. Keep the overlay frozen in place for 200ms, then
    // play the 500ms lift animation. Total 700ms for the video to load.
    if (isMagazineOverlayRoute && shouldHoldOverlayForVideoSwitch) {
      if (overlayCloseTimeoutRef.current !== null) {
        window.clearTimeout(overlayCloseTimeoutRef.current);
        overlayCloseTimeoutRef.current = null;
      }

      // Keep the overlay visible during navigation.
      setIsOverlayClosing(true);
      shouldRunFooterRevealRef.current = false;
      setIsUndockSettling(false);
      setIsFooterRevealActive(false);

      // Navigate now — starts the video loading.
      onPush(nextHref);

      // Pause the CSS lift animation so the overlay stays in place.
      requestAnimationFrame(() => {
        const panel = document.querySelector(".favouritesBlind") as HTMLElement | null;
        if (panel) {
          panel.style.animationPlayState = "paused";
        }
      });

      // After 200ms, resume the animation. 500ms duration.
      overlayCloseTimeoutRef.current = window.setTimeout(() => {
        const panel = document.querySelector(".favouritesBlind") as HTMLElement | null;
        if (panel) {
          panel.style.animationPlayState = "running";
        }

        overlayCloseTimeoutRef.current = window.setTimeout(() => {
          setIsOverlayClosing(false);
          overlayCloseTimeoutRef.current = null;
        }, 500);
      }, 200);

      return;
    }

    if (isOverlayToOverlayCloseTarget) {
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

    // Navigate during the close animation so the shell shows its loading
    // state (not the old video) while the new video resolves. The /new
    // page already works this way; magazine overlays now follow suit.
    const shouldNavigateDuringCloseAnimation =
      (pathname === "/new" || isMagazineOverlayRoute) && shouldHoldOverlayForVideoSwitch;

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
    setIsFooterRevealActive,
    setIsOverlayClosing,
    setIsUndockSettling,
    shouldShowOverlayPanel,
  ]);

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

  return {
    playerChromeRef,
    handleOverlayCloseRequest,
  };
}