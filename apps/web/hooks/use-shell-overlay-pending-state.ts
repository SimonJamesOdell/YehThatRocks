"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

export function useShellOverlayPendingState({
  pathname,
  requestedVideoId,
  currentVideoId,
  isResolvingInitialVideo,
  isResolvingRequestedVideo,
  router,
}: {
  pathname: string;
  requestedVideoId: string | null;
  currentVideoId: string;
  isResolvingInitialVideo: boolean;
  isResolvingRequestedVideo: boolean;
  router: AppRouterInstance;
}) {
  const [pendingOverlayOpenKind, setPendingOverlayOpenKind] = useState<"wiki" | "video" | null>(null);
  const [pendingOverlayRouteKey, setPendingOverlayRouteKey] = useState<string | null>(null);
  const [pendingOverlayCloseVideoId, setPendingOverlayCloseVideoId] = useState<string | null>(null);
  const [pendingOverlayCloseHref, setPendingOverlayCloseHref] = useState<string | null>(null);

  const retryPendingOverlayVideoLoad = useCallback(() => {
    if (!pendingOverlayCloseVideoId) {
      return;
    }

    const retryHref = pendingOverlayCloseHref ?? `/?v=${encodeURIComponent(pendingOverlayCloseVideoId)}&resume=1`;
    setPendingOverlayOpenKind("video");
    router.replace(retryHref);
    router.refresh();
  }, [pendingOverlayCloseHref, pendingOverlayCloseVideoId, router]);

  useEffect(() => {
    if (pathname !== "/" && pendingOverlayOpenKind !== null) {
      setPendingOverlayOpenKind(null);
    }
  }, [pathname, pendingOverlayOpenKind]);

  useEffect(() => {
    if (!pendingOverlayCloseVideoId) {
      return;
    }

    if (pathname !== "/") {
      setPendingOverlayCloseVideoId(null);
      setPendingOverlayCloseHref(null);
      return;
    }

    if (
      requestedVideoId !== pendingOverlayCloseVideoId
      || currentVideoId !== pendingOverlayCloseVideoId
      || isResolvingInitialVideo
      || isResolvingRequestedVideo
    ) {
      return;
    }

    setPendingOverlayCloseVideoId(null);
    setPendingOverlayCloseHref(null);
    setPendingOverlayOpenKind(null);
  }, [
    currentVideoId,
    isResolvingInitialVideo,
    isResolvingRequestedVideo,
    pathname,
    pendingOverlayCloseVideoId,
    requestedVideoId,
  ]);

  useEffect(() => {
    if (!pendingOverlayRouteKey || pathname === "/") {
      return;
    }

    setPendingOverlayRouteKey(null);
  }, [pathname, pendingOverlayRouteKey]);

  return {
    pendingOverlayOpenKind,
    setPendingOverlayOpenKind,
    pendingOverlayRouteKey,
    setPendingOverlayRouteKey,
    pendingOverlayCloseVideoId,
    setPendingOverlayCloseVideoId,
    pendingOverlayCloseHref,
    setPendingOverlayCloseHref,
    retryPendingOverlayVideoLoad,
  };
}
