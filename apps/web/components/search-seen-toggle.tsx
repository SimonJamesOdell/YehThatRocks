"use client";

import { useState, useEffect } from "react";

type SearchSeenToggleProps = {
  trackStackId: string;
  hasSeen: boolean;
};

const HIDE_SEEN_CLASS = "searchResultsHideSeen";

export function SearchSeenToggle({ trackStackId, hasSeen }: SearchSeenToggleProps) {
  const [hideSeen, setHideSeen] = useState(false);

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
