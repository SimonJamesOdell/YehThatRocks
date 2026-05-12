"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type MagazineRailTrack = {
  slug: string;
  videoId: string;
  title: string;
  artist: string;
  kicker?: string | null;
  genre: string;
};

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
  deletingMessageIds: number[];
  flashingChatTabs: Record<FlashableChatMode, boolean>;
  chatListRef: React.RefObject<HTMLDivElement | null>;
  latestMagazineTracks: MagazineRailTrack[];
  handleChatSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleDeleteChatMessage: (messageId: number) => Promise<void>;
};

type ChatDeleteEvent = {
  type: "message-deleted";
  messageId: number;
};

// ── Hook ───────────────────────────────────────────────────────────────────

export function useChatState({
  initialPathname,
  pathname,
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
  pathname: string;
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
  const [deletingMessageIds, setDeletingMessageIds] = useState<number[]>([]);
  const [flashingChatTabs, setFlashingChatTabs] = useState<Record<FlashableChatMode, boolean>>({
    global: false,
  });

  const chatListRef = useRef<HTMLDivElement | null>(null);
  const chatModeRef = useRef<ChatMode>(chatMode);
  const flashTimeoutRef = useRef<Record<FlashableChatMode, number | null>>({
    global: null,
  });

  const [latestMagazineTracks, setLatestMagazineTracks] = useState<MagazineRailTrack[]>([]);

  // Computed from auth + chat mode so the chat state stays mounted while overlay pages are open.
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
  // When entering magazine: switch to magazine tab.
  // When leaving magazine: reset to global (unless user already switched to another tab).
  useEffect(() => {
    if (isMagazineOverlayRoute) {
      setChatMode("magazine");
    } else {
      setChatMode((prev) => (prev === "magazine" ? "global" : prev));
    }
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

  // Load the latest magazine rail cards from the API instead of static fallback data.
  useEffect(() => {
    let cancelled = false;

    const loadLatestMagazine = async () => {
      try {
        const response = await fetch("/api/magazine/latest?limit=8", { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) {
            setLatestMagazineTracks([]);
          }
          return;
        }

        const payload = (await response.json()) as { articles?: MagazineRailTrack[] };
        if (!cancelled) {
          setLatestMagazineTracks(Array.isArray(payload.articles) ? payload.articles : []);
        }
      } catch {
        if (!cancelled) {
          setLatestMagazineTracks([]);
        }
      }
    };

    void loadLatestMagazine();

    return () => {
      cancelled = true;
    };
  }, [isMagazineOverlayRoute]);

  // Real-time SSE subscription for global chat.
  useEffect(() => {
    if (!shouldRunChat) {
      return;
    }

    const handleIncomingMessage = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as ChatMessage | ChatDeleteEvent;

        if (
          typeof payload === "object"
          && payload !== null
          && "type" in payload
          && payload.type === "message-deleted"
        ) {
          const messageId = Number(payload.messageId);
          if (!Number.isInteger(messageId) || messageId <= 0) {
            return;
          }
          setChatMessages((current) => current.filter((message) => message.id !== messageId));
          setDeletingMessageIds((current) => current.filter((id) => id !== messageId));
          return;
        }

        const message = payload as ChatMessage;

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
    setDeletingMessageIds([]);
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

  useEffect(() => {
    if (chatMode !== "magazine" || !(pathname === "/magazine" || pathname.startsWith("/magazine/"))) {
      return;
    }

    const node = chatListRef.current;
    if (!node) {
      return;
    }

    node.scrollTop = 0;
  }, [chatMode, latestMagazineTracks.length, pathname]);

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

  async function handleDeleteChatMessage(messageId: number) {
    if (!Number.isInteger(messageId) || messageId <= 0) {
      return;
    }

    if (deletingMessageIds.includes(messageId)) {
      return;
    }

    setDeletingMessageIds((current) => [...current, messageId]);
    setChatError(null);

    try {
      const response = await fetchWithAuthRetry("/api/chat", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messageId }),
      });

      if (response.status === 401 || response.status === 403) {
        void checkAuthState();
        onAuthLost?.();
        setChatError("Only admins can delete chat comments.");
        return;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setChatError(payload?.error ?? "Unable to delete message.");
        return;
      }

      setChatMessages((current) => current.filter((message) => message.id !== messageId));
    } catch {
      setChatError("Unable to delete message.");
    } finally {
      setDeletingMessageIds((current) => current.filter((id) => id !== messageId));
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
    deletingMessageIds,
    flashingChatTabs,
    chatListRef,
    latestMagazineTracks,
    handleChatSubmit,
    handleDeleteChatMessage,
  };
}
