"use client";

import { useEffect } from "react";

import { useSeenTogglePreference } from "@/components/use-seen-toggle-preference";

type SearchSeenToggleProps = {
  trackStackId: string;
  hasSeen: boolean;
  isAuthenticated: boolean;
};

const HIDE_SEEN_CLASS = "searchResultsHideSeen";
const SEARCH_HIDE_SEEN_TOGGLE_KEY_PREFIX = "ytr-toggle-hide-seen-search";

export function SearchSeenToggle({ trackStackId, hasSeen, isAuthenticated }: SearchSeenToggleProps) {
  const toggleKey = `${SEARCH_HIDE_SEEN_TOGGLE_KEY_PREFIX}:${trackStackId}`;
  const [hideSeen, setHideSeen] = useSeenTogglePreference({
    key: toggleKey,
    isAuthenticated,
  });

  useEffect(() => {
    const el = document.getElementById(trackStackId);
    if (el) {
      el.classList.toggle(HIDE_SEEN_CLASS, hideSeen);
    }
  }, [hideSeen, trackStackId]);

  if (!hasSeen) {
    return null;
  }

  return (
    <button
      type="button"
      className={`newPageSeenToggle${hideSeen ? " newPageSeenToggleActive" : ""}`}
      onClick={() => setHideSeen((v) => !v)}
      aria-pressed={hideSeen}
    >
      {hideSeen ? "Showing unseen only" : "Show unseen only"}
    </button>
  );
}
