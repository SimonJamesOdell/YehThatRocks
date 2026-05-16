import { useEffect, useRef } from "react";
import { OVERLAY_OPEN_REQUEST_EVENT, OVERLAY_CLOSE_REQUEST_EVENT } from "@/lib/events-contract";

type OverlayOpenDetails = {
  href?: string;
  kind?: string;
};

type OverlayCloseDetails = {
  href?: string;
};

type UseOverlayEventHandlingOptions = {
  pathname: string;
  isCategoriesRoute: boolean;
  onOpenRequest: (kind: "wiki" | "video", routeKey: string) => void;
  onCloseRequest: (href: string) => void;
  onResetPendingOverlay: () => void;
};


function isCategoriesOverlayPath(pathname: string): boolean {
  return pathname === "/categories" || pathname.startsWith("/categories/");
}

export function useOverlayEventHandling({
  pathname,
  isCategoriesRoute,
  onOpenRequest,
  onCloseRequest,
  onResetPendingOverlay,
}: UseOverlayEventHandlingOptions): void {
  const overlayOpenTimeoutRef = useRef<number | null>(null);
  const favouritesBlindInnerRef = useRef<HTMLDivElement | null>(null);

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

      const kind = openEvent.detail?.kind === "wiki" || openUrl.pathname.endsWith("/wiki") ? ("wiki" as const) : ("video" as const);

      const optimisticRouteKey = (() => {
        if (isCategoriesOverlayPath(openUrl.pathname) && isCategoriesRoute) {
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

      const node = favouritesBlindInnerRef.current;
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

    window.addEventListener(OVERLAY_OPEN_REQUEST_EVENT, handleOverlayOpenRequest);

    return () => {
      window.removeEventListener(OVERLAY_OPEN_REQUEST_EVENT, handleOverlayOpenRequest);
      if (overlayOpenTimeoutRef.current !== null) {
        window.clearTimeout(overlayOpenTimeoutRef.current);
        overlayOpenTimeoutRef.current = null;
      }
    };
  }, [pathname, isCategoriesRoute, onOpenRequest, onResetPendingOverlay]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

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

    window.addEventListener(OVERLAY_CLOSE_REQUEST_EVENT, handleOverlayCloseRequest);

    return () => {
      window.removeEventListener(OVERLAY_CLOSE_REQUEST_EVENT, handleOverlayCloseRequest);
    };
  }, [onCloseRequest]);
}
