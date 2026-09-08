"use client";

import { useEffect, useRef } from "react";

import { hasRecentlySolvedPow, submitPowSolution } from "@/lib/pow-client";

/**
 * Silently solves the client-side proof-of-work once per ~week and posts it to
 * /api/bot-challenge, which sets the httpOnly `ytr_botok` cookie. That cookie
 * is then verified server-side by the human-trust gate for sensitive routes.
 *
 * This runs a few hundred milliseconds of hashing after first paint, then is
 * remembered in localStorage so it does not repeat on every navigation. The
 * solving logic is shared with the visible trust-challenge interstitial.
 */
export function BotChallengeSolver() {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current || typeof window === "undefined") {
      return;
    }
    ranRef.current = true;

    if (hasRecentlySolvedPow()) {
      return;
    }

    const timer = window.setTimeout(() => {
      void submitPowSolution();
    }, 1500);

    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
