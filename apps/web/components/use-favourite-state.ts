"use client";

import { useEffect, useRef, useState } from "react";

import type { VideoRecord } from "@/lib/catalog";
import { dispatchAppEvent, EVENT_NAMES } from "@/lib/events-contract";
import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";

export type UseFavouriteStateReturn = {
  isCurrentVideoFavourited: boolean;
  setIsCurrentVideoFavourited: React.Dispatch<React.SetStateAction<boolean>>;
  favouriteSaveState: "idle" | "saving" | "saved" | "error";
  removeFavouriteState: "idle" | "removing";
  setRemoveFavouriteState: React.Dispatch<React.SetStateAction<"idle" | "removing">>;
  showRemoveFavouriteConfirm: boolean;
  setShowRemoveFavouriteConfirm: React.Dispatch<React.SetStateAction<boolean>>;
  handleAddFavourite: () => Promise<void>;
  handleRemoveFavourite: () => Promise<void>;
};

export function useFavouriteState({
  currentVideo,
  isLoggedIn,
}: {
  currentVideo: VideoRecord;
  isLoggedIn: boolean;
}): UseFavouriteStateReturn {
  const [isCurrentVideoFavourited, setIsCurrentVideoFavourited] = useState(
    Number(currentVideo.favourited ?? 0) > 0,
  );
  const [favouriteSaveState, setFavouriteSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [removeFavouriteState, setRemoveFavouriteState] = useState<"idle" | "removing">("idle");
  const [showRemoveFavouriteConfirm, setShowRemoveFavouriteConfirm] = useState(false);
  const favouriteSaveTimeoutRef = useRef<number | null>(null);

  // Reset favourite state when video changes.
  useEffect(() => {
    setIsCurrentVideoFavourited(Number(currentVideo.favourited ?? 0) > 0);
    setRemoveFavouriteState("idle");
    setShowRemoveFavouriteConfirm(false);
  }, [currentVideo]);

  // Cleanup timeout on unmount.
  useEffect(() => {
    return () => {
      if (favouriteSaveTimeoutRef.current !== null) {
        window.clearTimeout(favouriteSaveTimeoutRef.current);
        favouriteSaveTimeoutRef.current = null;
      }
    };
  }, []);

  async function handleAddFavourite() {
    setFavouriteSaveState("saving");

    try {
      const response = await fetchWithAuthRetry("/api/favourites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: currentVideo.id, action: "add" }),
      });

      if (response.ok) {
        setIsCurrentVideoFavourited(true);
        dispatchAppEvent(EVENT_NAMES.FAVOURITES_UPDATED, null);
      }

      setFavouriteSaveState(response.ok ? "saved" : "error");
    } catch {
      setFavouriteSaveState("error");
    }

    if (favouriteSaveTimeoutRef.current !== null) {
      window.clearTimeout(favouriteSaveTimeoutRef.current);
    }

    favouriteSaveTimeoutRef.current = window.setTimeout(() => {
      setFavouriteSaveState("idle");
      favouriteSaveTimeoutRef.current = null;
    }, 2000);
  }

  async function handleRemoveFavourite() {
    if (!isLoggedIn || removeFavouriteState === "removing") {
      return;
    }

    setRemoveFavouriteState("removing");

    try {
      const response = await fetchWithAuthRetry("/api/favourites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: currentVideo.id, action: "remove" }),
      });

      if (!response.ok) {
        return;
      }

      setIsCurrentVideoFavourited(false);
      setShowRemoveFavouriteConfirm(false);
      setFavouriteSaveState("idle");
      dispatchAppEvent(EVENT_NAMES.FAVOURITES_UPDATED, null);
    } finally {
      setRemoveFavouriteState("idle");
    }
  }

  return {
    isCurrentVideoFavourited,
    setIsCurrentVideoFavourited,
    favouriteSaveState,
    removeFavouriteState,
    setRemoveFavouriteState,
    showRemoveFavouriteConfirm,
    setShowRemoveFavouriteConfirm,
    handleAddFavourite,
    handleRemoveFavourite,
  };
}
