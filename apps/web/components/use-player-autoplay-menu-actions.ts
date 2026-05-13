"use client";

import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";

import { buildRootAutoplayFallbackParams, buildRouteAutoplayNavigationParams } from "@/components/player-experience-autoplay-domain";
import { resolveRouteAutoplaySource, type RouteAutoplaySource } from "@/components/player-experience-autoplay-utils";

export function usePlayerAutoplayMenuActions({
  isLoggedIn,
  isPlayerPreferencesServerHydrated,
  pathname,
  currentVideoId,
  searchParams,
  setAutoplayEnabled,
  setShowAutoplayMenu,
  autoplayStorageKey,
  autoplayRouteTransitionRef,
  buildRouteAutoplayPlaylist,
  routerPush,
}: {
  isLoggedIn: boolean;
  isPlayerPreferencesServerHydrated: boolean;
  pathname: string;
  currentVideoId: string;
  searchParams: URLSearchParams | { toString(): string };
  setAutoplayEnabled: Dispatch<SetStateAction<boolean>>;
  setShowAutoplayMenu: Dispatch<SetStateAction<boolean>>;
  autoplayStorageKey: string;
  autoplayRouteTransitionRef: MutableRefObject<boolean>;
  buildRouteAutoplayPlaylist: (source: RouteAutoplaySource) => Promise<{ playlistId: string | null; firstVideoId: string | null }>;
  routerPush: (href: string) => void;
}) {
  const persistAutoplayPreference = useCallback(async (value: boolean) => {
    if (!isLoggedIn || !isPlayerPreferencesServerHydrated) {
      return;
    }

    try {
      await fetch("/api/player-preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          autoplayEnabled: value,
        }),
      });
    } catch {
      // Preserve immediate toggle behavior even if background persistence fails.
    }
  }, [isLoggedIn, isPlayerPreferencesServerHydrated]);

  const handleSetAutoplayEnabled = useCallback(async (value: boolean) => {
    if (!isLoggedIn) {
      return;
    }

    setAutoplayEnabled(value);
    setShowAutoplayMenu(false);
    window.localStorage.setItem(autoplayStorageKey, value ? "true" : "false");
    void persistAutoplayPreference(value);

    if (!value) {
      return;
    }

    const autoplaySource = resolveRouteAutoplaySource(pathname);

    if (autoplaySource) {
      if (autoplaySource.type === "new" || autoplaySource.type === "top100") {
        autoplayRouteTransitionRef.current = false;
        return;
      }

      autoplayRouteTransitionRef.current = true;
      const { playlistId, firstVideoId } = await buildRouteAutoplayPlaylist(autoplaySource);
      const targetVideoId = firstVideoId ?? currentVideoId;
      const params = buildRouteAutoplayNavigationParams({
        targetVideoId,
        playlistId,
      });

      routerPush(`/?${params.toString()}`);
      return;
    }

    if (pathname !== "/") {
      autoplayRouteTransitionRef.current = true;
      const params = buildRootAutoplayFallbackParams(new URLSearchParams(searchParams.toString()), currentVideoId);
      routerPush(`/?${params.toString()}`);
    }
  }, [
    autoplayRouteTransitionRef,
    autoplayStorageKey,
    buildRouteAutoplayPlaylist,
    currentVideoId,
    isLoggedIn,
    pathname,
    persistAutoplayPreference,
    routerPush,
    searchParams,
    setAutoplayEnabled,
    setShowAutoplayMenu,
  ]);

  const handleAutoplayMenuButtonClick = useCallback(() => {
    if (!isLoggedIn) {
      return;
    }

    setShowAutoplayMenu((current) => !current);
  }, [isLoggedIn, setShowAutoplayMenu]);

  return {
    handleSetAutoplayEnabled,
    handleAutoplayMenuButtonClick,
  };
}
