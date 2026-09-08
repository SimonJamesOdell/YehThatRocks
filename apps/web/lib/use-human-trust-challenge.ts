"use client";

import { useEffect, useState } from "react";

import { hasRecentlySolvedPow } from "@/lib/pow-client";

/**
 * Decides whether a client still needs a visible human-verification challenge.
 *
 * A client is already evidenced (and therefore skips the interstitial) when it
 * has solved the proof-of-work recently — either in this session via the silent
 * background solver, or on a previous visit. The interstitial appears only for
 * genuinely cold clients opening a sensitive flow.
 */
export function useHumanTrustChallenge(): {
  needsChallenge: boolean;
  dismissChallenge: () => void;
} {
  const [needsChallenge, setNeedsChallenge] = useState(false);

  useEffect(() => {
    setNeedsChallenge(!hasRecentlySolvedPow());
  }, []);

  return {
    needsChallenge,
    dismissChallenge: () => setNeedsChallenge(false),
  };
}
