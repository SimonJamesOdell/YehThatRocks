"use client";

import { useEffect, useRef, useState } from "react";

import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";

type SearchResultFavouriteButtonProps = {
  videoId: string;
  title: string;
  isAuthenticated: boolean;
};

export function SearchResultFavouriteButton({ videoId, title, isAuthenticated }: SearchResultFavouriteButtonProps) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const resetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  function scheduleReset() {
    if (resetTimeoutRef.current !== null) {
      window.clearTimeout(resetTimeoutRef.current);
    }

    resetTimeoutRef.current = window.setTimeout(() => {
      setState("idle");
      resetTimeoutRef.current = null;
    }, 1800);
  }

  async function handleAdd() {
    if (!isAuthenticated || state === "saving") {
      return;
    }

    setState("saving");

    try {
      const response = await fetchWithAuthRetry("/api/favourites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, action: "add" }),
      });

      if (response.ok) {
        window.dispatchEvent(new Event("ytr:favourites-updated"));
      }

      setState(response.ok ? "saved" : "error");
    } catch {
      setState("error");
    }

    scheduleReset();
  }

  const label = state === "saved" ? "Saved" : state === "error" ? "Retry" : "Add to favourites";

  return (
    <button
      type="button"
      className="queueBadge searchResultFavouriteBadgeButton"
      aria-label={`${label}: ${title}`}
      title={isAuthenticated ? "Add to favourites" : "Sign in to add favourites"}
      disabled={!isAuthenticated || state === "saving"}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void handleAdd();
      }}
    >
      <span className="navFavouritesGlyph" aria-hidden="true">❤️</span>
    </button>
  );
}
