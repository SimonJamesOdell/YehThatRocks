"use client";

import { useCallback } from "react";

import { OVERLAY_OPEN_REQUEST_EVENT } from "@/lib/events-contract";

type OverlayKind = "video" | "wiki";

type UseShellNavigationHelpersParams = {
  currentVideoId: string;
  activeArtistLetter: string;
  isAuthenticated: boolean;
  onOpenAuthModal: () => void;
  onPush: (href: string) => void;
};

export function useShellNavigationHelpers({
  currentVideoId,
  activeArtistLetter,
  isAuthenticated,
  onOpenAuthModal,
  onPush,
}: UseShellNavigationHelpersParams) {
  const getNavHref = useCallback((href: string) => {
    const params = new URLSearchParams();
    params.set("v", currentVideoId);
    params.set("resume", "1");
    if (href === "/artists") {
      params.set("letter", activeArtistLetter);
    }
    return `${href}?${params.toString()}`;
  }, [activeArtistLetter, currentVideoId]);

  const openAutoplaySettingsOverlay = useCallback(() => {
    if (!isAuthenticated) {
      onOpenAuthModal();
      return;
    }
    const accountHref = `${getNavHref("/account")}&tab=autoplay`;
    onPush(accountHref);
  }, [getNavHref, isAuthenticated, onOpenAuthModal, onPush]);

  const getUserProfileHref = useCallback((screenName: string, userId: number | null | undefined) => {
    const trimmedScreenName = screenName.trim();
    const hasStableUserId = typeof userId === "number" && Number.isInteger(userId) && userId > 0;
    const hasUsableScreenName = trimmedScreenName.length > 0 && trimmedScreenName.toLowerCase() !== "anonymous";
    if (!hasStableUserId && !hasUsableScreenName) {
      return null;
    }
    const slug = hasStableUserId ? `user-${userId}` : trimmedScreenName;
    const params = new URLSearchParams();
    params.set("v", currentVideoId);
    params.set("resume", "1");
    return `/u/${encodeURIComponent(slug)}?${params.toString()}`;
  }, [currentVideoId]);

  const requestOverlayOpen = useCallback((href: string, kind: OverlayKind = "video") => {
    if (typeof window === "undefined") {
      return;
    }
    window.dispatchEvent(new CustomEvent(OVERLAY_OPEN_REQUEST_EVENT, {
      detail: { href, kind },
    }));
  }, []);

  return {
    getNavHref,
    openAutoplaySettingsOverlay,
    getUserProfileHref,
    requestOverlayOpen,
  };
}
