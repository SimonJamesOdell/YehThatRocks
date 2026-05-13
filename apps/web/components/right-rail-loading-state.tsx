"use client";

type RightRailLoadingStateProps = {
  message?: string;
  ariaLabel?: string;
  busy?: boolean;
};

export function RightRailLoadingState({
  message,
  ariaLabel,
  busy = true,
}: RightRailLoadingStateProps) {
  return (
    <div
      className="relatedLoadingState"
      role="status"
      aria-live="polite"
      aria-busy={busy ? true : undefined}
      aria-label={ariaLabel}
    >
      <div className="playerBootBars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      {message ? <span>{message}</span> : null}
    </div>
  );
}
