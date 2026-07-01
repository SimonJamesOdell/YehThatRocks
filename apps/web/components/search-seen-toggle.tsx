"use client";

import { memo, useCallback, useEffect } from "react";

import { useSeenTogglePreference } from "@/hooks/use-seen-toggle-preference";

type SearchSeenToggleProps = {
  trackStackId: string;
  hasSeen: boolean;
  isAuthenticated: boolean;
};

const HIDE_SEEN_CLASS = "searchResultsHideSeen";
const SEARCH_HIDE_SEEN_TOGGLE_KEY_PREFIX = "ytr-toggle-hide-seen-search";

export const SearchSeenToggle = memo(function SearchSeenToggle({ trackStackId, hasSeen, isAuthenticated }: SearchSeenToggleProps) {
  const toggleKey = `${SEARCH_HIDE_SEEN_TOGGLE_KEY_PREFIX}:${trackStackId}`;
  const [hideSeen, setHideSeen] = useSeenTogglePreference({
    key: toggleKey,
    isAuthenticated,
  });

  const toggleHideSeen = useCallback(() => setHideSeen((v) => !v), [setHideSeen]);

  useEffect(() => {
    const el = document.getElementById(trackStackId);
    if (el) {
      el.classList.toggle(HIDE_SEEN_CLASS, hideSeen);
    }
  }, [hideSeen, trackStackId]);

  if (!isAuthenticated || !hasSeen) {
    return null;
  }

  return (
    <button
      type="button"
      className={`newPageSeenToggle${hideSeen ? " newPageSeenToggleActive" : ""}`}
      onClick={toggleHideSeen}
      aria-pressed={hideSeen}
    >
      {hideSeen ? "Showing unseen only" : "Show unseen only"}
    </button>
  );
});