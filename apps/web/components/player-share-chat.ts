import type { MutableRefObject } from "react";

import { buildSharedVideoMessage } from "@/lib/chat-shared-video";

type ShareToChatState = "idle" | "sending" | "sent" | "error";

export async function shareCurrentVideoToChat({
  isLoggedIn,
  currentVideoId,
  copyShareLink,
  setShowShareMenu,
  setShareToChatState,
  shareToChatResetTimeoutRef,
}: {
  isLoggedIn: boolean;
  currentVideoId: string;
  copyShareLink: () => Promise<void>;
  setShowShareMenu: (value: boolean) => void;
  setShareToChatState: (value: ShareToChatState) => void;
  shareToChatResetTimeoutRef: MutableRefObject<number | null>;
}) {
  if (!isLoggedIn) {
    await copyShareLink();
    setShowShareMenu(false);
    return;
  }

  const content = buildSharedVideoMessage(currentVideoId);
  if (!content) {
    setShareToChatState("error");
    return;
  }

  setShareToChatState("sending");
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "global",
        content,
      }),
    });

    if (!response.ok) {
      throw new Error(`share-chat-failed:${response.status}`);
    }

    setShareToChatState("sent");
  } catch {
    setShareToChatState("error");
  }

  if (shareToChatResetTimeoutRef.current !== null) {
    window.clearTimeout(shareToChatResetTimeoutRef.current);
  }

  shareToChatResetTimeoutRef.current = window.setTimeout(() => {
    setShareToChatState("idle");
    shareToChatResetTimeoutRef.current = null;
  }, 1800);

  setShowShareMenu(false);
}
