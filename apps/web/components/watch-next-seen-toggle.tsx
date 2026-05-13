"use client";

type WatchNextSeenToggleProps = {
  isActive: boolean;
  onToggle: () => void;
};

export function WatchNextSeenToggle({
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
}
