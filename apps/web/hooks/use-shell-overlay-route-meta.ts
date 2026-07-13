"use client";

import { useCallback, useMemo, type MouseEvent as ReactMouseEvent } from "react";

import { isArtistsOverlayPath } from "@/components/shell-dynamic-route-state";
import { OVERLAY_CLOSE_REQUEST_EVENT } from "@/lib/events-contract";

type OverlayOpenKind = "wiki" | "video" | null;

type UseShellOverlayRouteMetaParams = {
  pathname: string;
  searchParamsString: string;
  pendingOverlayRouteKey: string | null;
  pendingOverlayOpenKind: OverlayOpenKind;
  disableOverlayDropAnimation: boolean;
  isCategoriesRoute: boolean;
  shouldShowOverlayPanel: boolean;
  isOverlayClosing: boolean;
  onPush: (href: string) => void;
};

export function useShellOverlayRouteMeta({
  pathname,
  searchParamsString,
  pendingOverlayRouteKey,
  pendingOverlayOpenKind,
  disableOverlayDropAnimation,
  isCategoriesRoute,
  shouldShowOverlayPanel,
  isOverlayClosing,
  onPush,
}: UseShellOverlayRouteMetaParams) {
  const overlayRouteKey = useMemo(() => {
    if (pendingOverlayRouteKey) {
      return pendingOverlayRouteKey;
    }
    if (disableOverlayDropAnimation && isCategoriesRoute) {
      return "categories-overlay";
    }

    const searchParams = new URLSearchParams(searchParamsString);
    const filteredParams = new URLSearchParams();
    for (const [key, value] of searchParams.entries()) {
      if (key === "v" || key === "resume" || (pathname === "/admin" && key === "tab")) {
        continue;
      }
      filteredParams.append(key, value);
    }

    const filteredQuery = filteredParams.toString();
    return filteredQuery ? `${pathname}?${filteredQuery}` : pathname;
  }, [disableOverlayDropAnimation, isCategoriesRoute, pathname, pendingOverlayRouteKey, searchParamsString]);

  const isCategoriesOverlayPendingOrActive = useMemo(() => {
    return (
      isCategoriesRoute
      || pendingOverlayRouteKey === "categories-overlay"
      || pendingOverlayRouteKey?.startsWith("/categories") === true
    );
  }, [isCategoriesRoute, pendingOverlayRouteKey]);

  const isArtistsOverlayPendingOrActive = useMemo(() => {
    return (
      isArtistsOverlayPath(pathname)
      || pendingOverlayRouteKey === "artists-overlay"
      || pendingOverlayRouteKey?.startsWith("/artists") === true
    );
  }, [pathname, pendingOverlayRouteKey]);

  const routeLoadingLabel = pathname.endsWith("/wiki") || pendingOverlayOpenKind === "wiki" ? "Loading wiki" : "Loading video";
  const routeLoadingMessage = routeLoadingLabel === "Loading video"
    ? "connecting to upstream video provider..."
    : `${routeLoadingLabel}...`;

  const handleOverlayVideoLinkClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!shouldShowOverlayPanel || isOverlayClosing) {
      return;
    }
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return;
    }

    const target = event.target as Element | null;
    const anchor = target?.closest("a") as HTMLAnchorElement | null;
    if (!anchor) {
      return;
    }

    if (anchor.dataset.overlayCaptureSkip === "true") {
      return;
    }

    if (anchor.dataset.overlayClose === "true") {
      event.preventDefault();
      // Always derive the close href from the live window.location.search,
      // never from the anchor's href attribute. The DOM attribute is the
      // SSR value and may be stale after a native history.pushState (used
      // by navigateVideoHref for /new and /top100 video clicks) or while
      // an RSC payload is in flight. This also eliminates the race between
      // this capture handler and CloseLink's onClick — both now use the
      // same live source, so the didNavigate guard in handleOverlayCloseRequest
      // always sees the correct video ID regardless of which fires first.
      const liveV = new URLSearchParams(window.location.search).get("v");
      const href = liveV
        ? `/?v=${encodeURIComponent(liveV)}&resume=1`
        : "/";
      window.dispatchEvent(new CustomEvent(OVERLAY_CLOSE_REQUEST_EVENT, {
        detail: { href },
      }));
      return;
    }

    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== "/") {
      return;
    }

    const targetVideoId = url.searchParams.get("v");
    if (!targetVideoId) {
      return;
    }

    if (pathname === "/new" && target?.closest(".rightRail")) {
      event.preventDefault();
      url.searchParams.delete("resume");
      window.dispatchEvent(new CustomEvent(OVERLAY_CLOSE_REQUEST_EVENT, {
        detail: { href: `${url.pathname}${url.search}${url.hash}` },
      }));
      return;
    }

    event.preventDefault();
    const params = new URLSearchParams(searchParamsString);
    params.set("v", targetVideoId);
    params.delete("resume");
    const nextQuery = params.toString();
    onPush(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [isOverlayClosing, onPush, pathname, searchParamsString, shouldShowOverlayPanel]);

  return {
    overlayRouteKey,
    isCategoriesOverlayPendingOrActive,
    isArtistsOverlayPendingOrActive,
    routeLoadingLabel,
    routeLoadingMessage,
    handleOverlayVideoLinkClickCapture,
  };
}
