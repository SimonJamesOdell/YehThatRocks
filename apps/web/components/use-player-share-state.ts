"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

import { buildSharedVideoMessage } from "@/lib/chat-shared-video";
import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";

export function usePlayerShareState({
  currentVideoId,
  isLoggedIn,
  shareUrl,
  onDockHideRequest,
  pauseActivePlayback,
}: {
  currentVideoId: string;
  isLoggedIn: boolean;
  shareUrl: string;
  onDockHideRequest?: () => void;
  pauseActivePlayback: () => void;
}) {
  const shareToChatResetTimeoutRef = useRef<number | null>(null);
  const shareCopiedResetTimeoutRef = useRef<number | null>(null);
  const shareModalCopiedResetTimeoutRef = useRef<number | null>(null);

  const [copied, setCopied] = useState(false);
  const [shareToChatState, setShareToChatState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareModalCopied, setShareModalCopied] = useState(false);

  const triggerTimedShareFlag = useCallback((
    setFlag: (value: boolean) => void,
    timeoutRef: MutableRefObject<number | null>,
  ) => {
    setFlag(true);

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      setFlag(false);
      timeoutRef.current = null;
    }, 1600);
  }, []);

  const handleCopyShareLink = useCallback(async () => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl);
    } else {
      window.prompt("Copy this link", shareUrl);
    }

    triggerTimedShareFlag(setCopied, shareCopiedResetTimeoutRef);
  }, [shareUrl, triggerTimedShareFlag]);

  const handleDockClose = useCallback(() => {
    setShowShareMenu(false);
    pauseActivePlayback();
    onDockHideRequest?.();
    dispatchAppEvent(EVENT_NAMES.DOCK_HIDE_REQUEST, null);
  }, [onDockHideRequest, pauseActivePlayback]);

  const handleShareToChat = useCallback(async () => {
    if (!isLoggedIn) {
      await handleCopyShareLink();
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
  }, [currentVideoId, handleCopyShareLink, isLoggedIn]);

  const handleShareToSocials = useCallback(async () => {
    setShareModalCopied(false);
    setShowShareModal(true);
    setShowShareMenu(false);
  }, []);

  const handleShareTargetOpen = useCallback((targetUrl: string) => {
    window.open(targetUrl, "_blank", "noopener,noreferrer");
  }, []);

  const handleCopyShareUrlForModal = useCallback(async () => {
    await handleCopyShareLink();
    triggerTimedShareFlag(setShareModalCopied, shareModalCopiedResetTimeoutRef);
  }, [handleCopyShareLink, triggerTimedShareFlag]);

  useEffect(() => {
    if (!showShareModal) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowShareModal(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showShareModal]);

  useEffect(() => {
    return () => {
      if (shareToChatResetTimeoutRef.current !== null) {
        window.clearTimeout(shareToChatResetTimeoutRef.current);
        shareToChatResetTimeoutRef.current = null;
      }

      if (shareCopiedResetTimeoutRef.current !== null) {
        window.clearTimeout(shareCopiedResetTimeoutRef.current);
        shareCopiedResetTimeoutRef.current = null;
      }

      if (shareModalCopiedResetTimeoutRef.current !== null) {
        window.clearTimeout(shareModalCopiedResetTimeoutRef.current);
        shareModalCopiedResetTimeoutRef.current = null;
      }
    };
  }, []);

  return {
    copied,
    shareToChatState,
    showShareMenu,
    setShowShareMenu,
    showShareModal,
    setShowShareModal,
    shareModalCopied,
    setShareModalCopied,
    handleCopyShareLink,
    handleDockClose,
    handleShareToChat,
    handleShareToSocials,
    handleShareTargetOpen,
    handleCopyShareUrlForModal,
  };
}
