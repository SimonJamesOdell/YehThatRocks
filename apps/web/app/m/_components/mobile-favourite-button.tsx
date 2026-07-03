"use client";

import { useCallback, useState } from "react";

type FavouriteState = "idle" | "loading" | "favourited" | "not-favourited";

type MobileFavouriteButtonProps = {
  videoId: string;
  initialFavourited?: boolean;
  size?: "sm" | "md";
  onToggle?: (favourited: boolean) => void;
};

export function MobileFavouriteButton({
  videoId,
  initialFavourited = false,
  size = "md",
  onToggle,
}: MobileFavouriteButtonProps) {
  const [state, setState] = useState<FavouriteState>(
    initialFavourited ? "favourited" : "not-favourited",
  );
  const [error, setError] = useState<string | null>(null);

  const handleToggle = useCallback(async (e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const previousState = state;
    const isFavourited = previousState === "favourited";
    const action = isFavourited ? "remove" : "add";

    setState("loading");
    setError(null);

    try {
      const res = await fetch("/api/favourites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, action }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (res.status === 401) {
          throw new Error("Login required");
        }
        throw new Error(data?.error || "Failed to update favourite");
      }

      const newFavourited = !isFavourited;
      setState(newFavourited ? "favourited" : "not-favourited");
      onToggle?.(newFavourited);
    } catch (err) {
      setState(previousState);
      setError(err instanceof Error ? err.message : "Something went wrong");
      // Clear error after a few seconds
      setTimeout(() => setError(null), 3000);
    }
  }, [videoId, state, onToggle]);

  const isActive = state === "favourited";
  const isLoading = state === "loading";
  const iconSize = size === "sm" ? 16 : 20;

  return (
    <button
      type="button"
      className={`mobile-fav-button ${isActive ? "mobile-fav-button-active" : ""} ${isLoading ? "mobile-fav-button-loading" : ""}`}
      onClick={handleToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          handleToggle(e);
        }
      }}
      disabled={isLoading}
      aria-label={isActive ? "Remove from favourites" : "Add to favourites"}
      title={error || (isActive ? "Remove from favourites" : "Add to favourites")}
    >
      {isLoading ? (
        <svg
          viewBox="0 0 24 24"
          width={iconSize}
          height={iconSize}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="mobile-fav-spinner"
        >
          <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
          <path d="M12 2a10 10 0 0 1 10 10" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          width={iconSize}
          height={iconSize}
          fill={isActive ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      )}
      {error && <span className="mobile-fav-error">{error}</span>}
    </button>
  );
}
