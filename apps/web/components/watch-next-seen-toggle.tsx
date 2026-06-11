"use client";

import { memo } from "react";

type WatchNextSeenToggleProps = {
  isActive: boolean;
  onToggle: () => void;
};

export const WatchNextSeenToggle = memo(function WatchNextSeenToggle({
  isActive,
  onToggle,
}: WatchNextSeenToggleProps) {
  return (
    <div className="rightRailWatchNextHeader">
      <button
        type="button"
        className={`newPageSeenToggle watchNextSeenToggle${isActive ? " newPageSeenToggleActive" : ""}`}
        onClick={onToggle}
        aria-pressed={isActive}
      >
        {isActive ? "Showing unseen only" : "Show unseen only"}
      </button>
    </div>
  );
});