"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { magazineDraftEdition } from "@/lib/magazine-draft";

// ── Types ──────────────────────────────────────────────────────────────────

export type ChatMode = "global" | "magazine" | "online";

export type ChatMessage = {
  id: number;
  content: string;
  createdAt: string | null;
  room: string;
  videoId: string | null;
  user: {
    id: number | null;
    name: string;
    avatarUrl: string | null;
  };
};

export type OnlineUser = {
  id: number;
  name: string;
  avatarUrl: string | null;
  lastSeen: string | null;
  isOnline?: boolean;
};

type FlashableChatMode = "global";

export type ChatStateResult = {
  chatMode: ChatMode;
  setChatMode: (mode: ChatMode) => void;
  chatMessages: ChatMessage[];
  onlineUsers: OnlineUser[];
  chatDraft: string;
  setChatDraft: (draft: string) => void;
  chatError: string | null;
  isChatLoading: boolean;
  isChatSubmitting: boolean;
  flashingChatTabs: Record<FlashableChatMode, boolean>;
  chatListRef: React.RefObject<HTMLDivElement | null>;
  latestMagazineTracks: typeof magazineDraftEdition.tracks;
  handleChatSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

// ── Hook ───────────────────────────────────────────────────────────────────

export function useChatState({
  initialPathname,
  isAuthenticated,
  isMagazineOverlayRoute,
  isAdminOverlayRoute,
  shouldShowOverlayPanel,
  fetchWithAuthRetry,
  checkAuthState,
  onAuthLost,
}: {
  /** Pathname at first render — sets initial chat mode. */
  initialPathname: string;
  isAuthenticated: boolean;
  isMagazineOverlayRoute: boolean;
  isAdminOverlayRoute: boolean;
  /** Whether the overlay panel is currently shown — used to decide if chat should run. */
  shouldShowOverlayPanel: boolean;
  fetchWithAuthRetry: (input: string, init?: RequestInit) => Promise<Response>;
  checkAuthState: () => Promise<"authenticated" | "unauthenticated" | "unavailable">;
  /** Called when a chat request returns 401/403 to trigger re-auth. */
  onAuthLost?: () => void;
}): ChatStateResult {
  const [chatMode, setChatMode] = useState<ChatMode>(() =>
    initialPathname === "/magazine" || initialPathname.startsWith("/magazine/")
      ? "magazine"
      : "global"
  );
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isChatSubmitting, setIsChatSubmitting] = useState(false);
  const [flashingChatTabs, setFlashingChatTabs] = useState<Record<FlashableChatMode, boolean>>({
    global: false,
  });

  const chatListRef = useRef<HTMLDivElement | null>(null);
  const chatModeRef = useRef<ChatMode>(chatMode);
  const flashTimeoutRef = useRef<Record<FlashableChatMode, number | null>>({
    global: null,
  });

  const latestMagazineTracks = useMemo(() => magazineDraftEdition.tracks, []);

  // Computed from external params + internal chatMode (avoids circular dependency if caller derived this from chatMode).
  const shouldRunChat = (!shouldShowOverlayPanel || isMagazineOverlayRoute) && (isAuthenticated || chatMode === "global");

  // Keep the ref in sync for use inside event handlers.
  useEffect(() => {
    chatModeRef.current = chatMode;
  }, [chatMode]);

  // Sync chat mode to admin overlay route (always global there).
  useEffect(() => {
    if (!isAdminOverlayRoute) {
      return;
    }

    setChatMode("global");
  }, [isAdminOverlayRoute]);

  // Sync chat mode to magazine overlay route.
  useEffect(() => {
    if (!isMagazineOverlayRoute) {
      return;
    }

    setChatMode("magazine");
  }, [isMagazineOverlayRoute]);

  // Load chat history whenever mode / auth changes.
  // For "online" mode we also keep a 30 s refresh so presence stays current.
  useEffect(() => {
    if (!shouldRunChat) {
      return;
    }

    if (chatMode === "magazine") {
      setChatMessages([]);
      setOnlineUsers([]);
      setChatError(null);
      setIsChatLoading(false);
      return;
    }

    let cancelled = false;

    const loadChat = async () => {
      setIsChatLoading(true);
      setChatError(null);

      try {
        const params = new URLSearchParams({ mode: chatMode });

        const response = await fetchWithAuthRetry(`/api/chat?${params.toString()}`);

        if (response.status === 401 || response.status === 403) {
          if (!cancelled) {
            void checkAuthState();
            onAuthLost?.();
            setChatError(null);
          }
          return;
        }

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          if (!cancelled) {
            setChatError(payload?.error ?? "Chat failed to load.");
          }
          return;
        }

        const payload = (await response.json()) as { messages?: ChatMessage[]; onlineUsers?: OnlineUser[] };
        if (!cancelled) {
          setChatMessages(Array.isArray(payload.messages) ? payload.messages : []);
          setOnlineUsers(Array.isArray(payload.onlineUsers) ? payload.onlineUsers : []);
        }
      } catch {
        if (!cancelled) {
          setChatError("Chat failed to load.");
        }
      } finally {
        if (!cancelled) {
          setIsChatLoading(false);
        }
      }
    };

    void loadChat();

    // Only the "online" presence tab needs periodic refresh.
    const intervalId =
      chatMode === "online"
        ? window.setInterval(() => { void loadChat(); }, 30_000)
        : undefined;

    return () => {
      cancelled = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [chatMode, checkAuthState, fetchWithAuthRetry, onAuthLost, shouldRunChat]);

  // Real-time SSE subscription for global chat.
  useEffect(() => {
    if (!shouldRunChat) {
      return;
    }

    const handleIncomingMessage = (event: MessageEvent<string>) => {
      try {
        const message = JSON.parse(event.data) as ChatMessage;

        const incomingMode: FlashableChatMode | null = message.room === "global"
          ? "global"
          : null;

        if (!incomingMode) {
          return;
        }

        if (chatModeRef.current !== incomingMode) {
          triggerChatTabFlash(incomingMode);
          return;
        }

        setChatMessages((current) => {
          // Deduplicate: the sender already added this via the POST response.
          if (current.some((m) => m.id === message.id)) return current;
          return [...current, message];
        });
      } catch {
        // ignore malformed events
      }
    };

    const globalEvents = new EventSource("/api/chat/stream?mode=global");

    globalEvents.onmessage = handleIncomingMessage;

    globalEvents.onerror = () => {
      // EventSource auto-reconnects; nothing to do here.
    };

    return () => {
      globalEvents.close();
    };
  }, [shouldRunChat]);

  // Cleanup flash timeouts on unmount.
  useEffect(() => {
    return () => {
      for (const mode of ["global"] as const) {
        const timeoutId = flashTimeoutRef.current[mode];
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
      }
    };
  }, []);

  // Reset all state when chat is no longer running.
  useEffect(() => {
    if (shouldRunChat) {
      return;
    }

    setChatDraft("");
    setChatError(null);
    setChatMessages([]);
    setOnlineUsers([]);
    setIsChatLoading(false);
    setIsChatSubmitting(false);
    if (!isMagazineOverlayRoute) {
      setChatMode("global");
    }
  }, [isMagazineOverlayRoute, shouldRunChat]);

  // Auto-scroll chat list to the latest message.
  useEffect(() => {
    const node = chatListRef.current;
    if (!node) {
      return;
    }

    node.scrollTop = node.scrollHeight;
  }, [chatMessages]);

  function triggerChatTabFlash(mode: FlashableChatMode) {
    const existingTimeoutId = flashTimeoutRef.current[mode];
    if (existingTimeoutId !== null) {
      window.clearTimeout(existingTimeoutId);
    }

    // Toggle off first so repeated arrivals retrigger the animation.
    setFlashingChatTabs((current) => ({
      ...current,
      [mode]: false,
    }));

    window.requestAnimationFrame(() => {
      setFlashingChatTabs((current) => ({
        ...current,
        [mode]: true,
      }));
    });

    flashTimeoutRef.current[mode] = window.setTimeout(() => {
      setFlashingChatTabs((current) => ({
        ...current,
        [mode]: false,
      }));
      flashTimeoutRef.current[mode] = null;
    }, 900);
  }

  async function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (chatMode !== "global") {
      return;
    }

    const content = chatDraft.trim();
    if (!content) {
      return;
    }

    setIsChatSubmitting(true);
    setChatError(null);

    try {
      const response = await fetchWithAuthRetry("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "global",
          content,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        void checkAuthState();
        onAuthLost?.();
        setChatError(null);
        return;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setChatError(payload?.error ?? "Unable to send message.");
        return;
      }

      const payload = (await response.json()) as { message?: ChatMessage };
      if (payload.message) {
        setChatMessages((current) => {
          if (current.some((message) => message.id === payload.message?.id)) {
            return current;
          }
          return [...current, payload.message as ChatMessage];
        });
      }
      setChatDraft("");
    } catch {
      setChatError("Unable to send message.");
    } finally {
      setIsChatSubmitting(false);
    }
  }

  return {
    chatMode,
    setChatMode,
    chatMessages,
    onlineUsers,
    chatDraft,
    setChatDraft,
    chatError,
    isChatLoading,
    isChatSubmitting,
    flashingChatTabs,
    chatListRef,
    latestMagazineTracks,
    handleChatSubmit,
  };
}
