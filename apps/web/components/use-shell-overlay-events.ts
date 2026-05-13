"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import { DOCK_HIDE_REQUEST_EVENT, OVERLAY_CLOSE_REQUEST_EVENT, OVERLAY_OPEN_REQUEST_EVENT } from "@/lib/events-contract";

type OverlayOpenDetails = {
  href?: string;
  kind?: string;
};

type OverlayCloseDetails = {
  href?: string;
};

export function useShellOverlayEvents({
  pathname,
  isCategoriesRoute,
  overlayScrollContainerRef,
  onOpenRequest,
  onResetPendingOverlay,
  onCloseRequest,
  onDockHideRequest,
}: {
  pathname: string;
  isCategoriesRoute: boolean;
  overlayScrollContainerRef: RefObject<HTMLDivElement | null>;
  onOpenRequest: (kind: "wiki" | "video", routeKey: string) => void;
  onResetPendingOverlay: () => void;
  onCloseRequest: (href: string) => void;
  onDockHideRequest: () => void;
}) {
  const overlayOpenTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleOverlayOpenRequest = (event: Event) => {
      const openEvent = event as CustomEvent<OverlayOpenDetails>;
      const href = openEvent.detail?.href;
      if (!href) {
        return;
      }

      const openUrl = new URL(href, window.location.origin);
      if (openUrl.origin !== window.location.origin) {
        return;
      }

      const kind = openEvent.detail?.kind === "wiki" || openUrl.pathname.endsWith("/wiki") ? "wiki" : "video";
      const optimisticRouteKey = (() => {
        if ((openUrl.pathname === "/categories" || openUrl.pathname.startsWith("/categories/")) && isCategoriesRoute) {
          return "categories-overlay";
        }

        const inputParams = new URLSearchParams(openUrl.search);
        const filteredParams = new URLSearchParams();
        for (const [key, value] of inputParams.entries()) {
          if (key === "v" || key === "resume" || (openUrl.pathname === "/admin" && key === "tab")) {
            continue;
          }
          filteredParams.append(key, value);
        }

        const filteredQuery = filteredParams.toString();
        return filteredQuery ? `${openUrl.pathname}?${filteredQuery}` : openUrl.pathname;
      })();

      onOpenRequest(kind, optimisticRouteKey);

      const node = overlayScrollContainerRef.current;
      if (node) {
        node.scrollTop = 0;
      }

      if (overlayOpenTimeoutRef.current !== null) {
        window.clearTimeout(overlayOpenTimeoutRef.current);
      }

      overlayOpenTimeoutRef.current = window.setTimeout(() => {
        overlayOpenTimeoutRef.current = null;
        if (pathname === "/") {
          onResetPendingOverlay();
        }
      }, 4500);
    };

    const handleOverlayCloseRequest = (event: Event) => {
      const closeEvent = event as CustomEvent<OverlayCloseDetails>;
      const href = closeEvent.detail?.href;
      if (!href) {
        return;
      }

      const closeUrl = new URL(href, window.location.origin);
      if (closeUrl.origin !== window.location.origin) {
        window.location.assign(closeUrl.toString());
        return;
      }

      onCloseRequest(href);
    };

    window.addEventListener(OVERLAY_OPEN_REQUEST_EVENT, handleOverlayOpenRequest);
    window.addEventListener(OVERLAY_CLOSE_REQUEST_EVENT, handleOverlayCloseRequest);
    window.addEventListener(DOCK_HIDE_REQUEST_EVENT, onDockHideRequest);

    return () => {
      window.removeEventListener(OVERLAY_OPEN_REQUEST_EVENT, handleOverlayOpenRequest);
      window.removeEventListener(OVERLAY_CLOSE_REQUEST_EVENT, handleOverlayCloseRequest);
      window.removeEventListener(DOCK_HIDE_REQUEST_EVENT, onDockHideRequest);
      if (overlayOpenTimeoutRef.current !== null) {
        window.clearTimeout(overlayOpenTimeoutRef.current);
        overlayOpenTimeoutRef.current = null;
      }
    };
  }, [isCategoriesRoute, onCloseRequest, onDockHideRequest, onOpenRequest, onResetPendingOverlay, overlayScrollContainerRef, pathname]);
}
