"use client";

import { useEffect, useState, type CSSProperties } from "react";

type CurrentVideoRetryDialogProps = {
  pendingReason?: "cooldown" | "concurrency-shed" | "timeout" | "resolver-error" | null;
  retryAfterMs: number;
  onRetryNow: () => void;
};

function formatCountdown(remainingMs: number) {
  const seconds = Math.max(0, remainingMs) / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }

  return `${Math.ceil(seconds)}s`;
}

function buildDialogCopy(pendingReason?: CurrentVideoRetryDialogProps["pendingReason"]) {
  switch (pendingReason) {
    case "cooldown":
      return {
        eyebrow: "Retry queued",
        title: "This tab is waiting for a free slot",
        body: "The request is still live. As soon as capacity is available, this tab will try again automatically.",
      };
    case "concurrency-shed":
      return {
        eyebrow: "Server is busy",
        title: "Another burst of tabs is already in flight",
        body: "We are keeping this request alive and will retry automatically while the server can accept it.",
      };
    case "timeout":
      return {
        eyebrow: "Timed out",
        title: "The last attempt took too long",
        body: "The connection is still recoverable, so the app will keep retrying until the request succeeds or you retry immediately.",
      };
    case "resolver-error":
    default:
      return {
        eyebrow: "Recovering connection",
        title: "The player is trying again",
        body: "This request will keep retrying automatically while the system can recover. You can also force the next attempt now.",
      };
  }
}

export function CurrentVideoRetryDialog({ pendingReason, retryAfterMs, onRetryNow }: CurrentVideoRetryDialogProps) {
  const [remainingMs, setRemainingMs] = useState(Math.max(0, Math.floor(retryAfterMs)));
  const copy = buildDialogCopy(pendingReason);
  const countdownMs = Math.max(100, Math.floor(retryAfterMs));

  useEffect(() => {
    const startedAt = Date.now();
    setRemainingMs(countdownMs);

    const timerId = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setRemainingMs(Math.max(0, countdownMs - elapsed));

      if (elapsed >= countdownMs) {
        window.clearInterval(timerId);
      }
    }, 100);

    return () => {
      window.clearInterval(timerId);
    };
  }, [countdownMs]);

  return (
    <div className="currentVideoRetryOverlay" role="presentation">
      <section
        className="currentVideoRetryDialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="current-video-retry-title"
        aria-describedby="current-video-retry-message"
      >
        <div className="currentVideoRetryCopy">
          <strong id="current-video-retry-title">{copy.title}</strong>
          <p className="currentVideoRetryEyebrow">{copy.eyebrow}</p>
          <p id="current-video-retry-message">{copy.body}</p>
        </div>
        <div className="currentVideoRetryCountdownWrap" aria-live="polite">
          <div
            className="currentVideoRetryCountdown"
            aria-hidden="true"
            style={{ "--countdown-ms": `${countdownMs}ms` } as CSSProperties}
          />
          <div className="currentVideoRetryCountdownMeta">
            <span>Automatic retry in {formatCountdown(remainingMs)}</span>
            <button type="button" className="currentVideoRetryButton" onClick={onRetryNow}>
              Retry now
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}