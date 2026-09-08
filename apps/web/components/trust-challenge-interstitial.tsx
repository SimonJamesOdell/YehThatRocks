"use client";

import { useCallback, useEffect, useState } from "react";

import { submitPowSolution } from "@/lib/pow-client";

/**
 * Visible human-verification interstitial. Solves the client-side proof-of-work
 * and notifies the caller when done, so a cold client can proceed with a
 * sensitive action without ever seeing a raw error.
 *
 * Styled with the site's modal tokens (dark panel, blood-red accent) so it
 * reads as part of the product rather than an external challenge page.
 */
export function TrustChallengeInterstitial({ onComplete }: { onComplete: () => void }) {
  const [status, setStatus] = useState<"solving" | "failed">("solving");

  const solve = useCallback(() => {
    setStatus("solving");
    void submitPowSolution().then((ok) => {
      if (ok) {
        onComplete();
      } else {
        setStatus("failed");
      }
    });
  }, [onComplete]);

  useEffect(() => {
    solve();
  }, [solve]);

  return (
    <div
      className="trustChallengeOverlay"
      role="dialog"
      aria-modal="true"
      aria-label="Human verification"
    >
      <div className="trustChallengePanel">
        <span className="trustChallengeGlyph" aria-hidden="true">
          ◈
        </span>
        <h2 className="trustChallengeTitle">One quick check</h2>
        <p className="trustChallengeCopy">
          {status === "solving"
            ? "Verifying you're human…"
            : "The check couldn't complete. Please try again."}
        </p>
        {status === "failed" ? (
          <button type="button" className="trustChallengeRetry" onClick={solve}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}
