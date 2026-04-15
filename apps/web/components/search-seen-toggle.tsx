"use client";

import { useState, useEffect } from "react";

import { readPersistedBoolean, writePersistedBoolean } from "@/lib/persisted-boolean";

type SearchSeenToggleProps = {
  trackStackId: string;
  hasSeen: boolean;
};

const HIDE_SEEN_CLASS = "searchResultsHideSeen";
const SEARCH_HIDE_SEEN_TOGGLE_KEY_PREFIX = "ytr-toggle-hide-seen-search";

export function SearchSeenToggle({ trackStackId, hasSeen }: SearchSeenToggleProps) {
  const toggleKey = `${SEARCH_HIDE_SEEN_TOGGLE_KEY_PREFIX}:${trackStackId}`;
  const [hideSeen, setHideSeen] = useState(() => readPersistedBoolean(toggleKey, false));

  useEffect(() => {
    const el = document.getElementById(trackStackId);
    if (el) {
      el.classList.toggle(HIDE_SEEN_CLASS, hideSeen);
    }
  }, [hideSeen, trackStackId]);

  useEffect(() => {
    writePersistedBoolean(toggleKey, hideSeen);
  }, [hideSeen, toggleKey]);

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
