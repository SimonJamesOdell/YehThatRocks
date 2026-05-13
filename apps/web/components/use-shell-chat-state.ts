"use client";

import { useEffect } from "react";

import { useChatState, type ChatStateResult } from "@/components/use-chat-state";

export function useShellChatState({
  pathname,
  isAuthenticated,
  isMagazineOverlayRoute,
  isAdminOverlayRoute,
  shouldShowOverlayPanel,
  fetchWithAuthRetry,
  checkAuthState,
}: {
  pathname: string;
  isAuthenticated: boolean;
  isMagazineOverlayRoute: boolean;
  isAdminOverlayRoute: boolean;
  shouldShowOverlayPanel: boolean;
  fetchWithAuthRetry: (input: string, init?: RequestInit) => Promise<Response>;
  checkAuthState: () => Promise<"authenticated" | "unauthenticated" | "unavailable">;
}): ChatStateResult {
  const chatState = useChatState({
    initialPathname: pathname,
    pathname,
    isAuthenticated,
    isMagazineOverlayRoute,
    isAdminOverlayRoute,
    shouldShowOverlayPanel: shouldShowOverlayPanel && pathname !== "/new",
    fetchWithAuthRetry,
    checkAuthState,
  });

  useEffect(() => {
    if (!isAdminOverlayRoute) {
      return;
    }
    chatState.setChatMode("global");
  }, [chatState, isAdminOverlayRoute]);

  useEffect(() => {
    if (!isMagazineOverlayRoute) {
      return;
    }
    chatState.setChatMode("magazine");
  }, [chatState, isMagazineOverlayRoute]);

  return chatState;
}
