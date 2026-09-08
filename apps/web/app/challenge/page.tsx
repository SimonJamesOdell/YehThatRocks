"use client";

import { useRouter } from "next/navigation";

import { TrustChallengeInterstitial } from "@/components/trust-challenge-interstitial";

/**
 * Full-page human-verification route. Used by ATTACK_MODE: cold clients are
 * redirected here, solve the proof-of-work, then return to where they were
 * headed. Mirrors the on-brand interstitial with a page-level shell.
 */
export default function ChallengePage() {
  const router = useRouter();

  function handleComplete() {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next") ?? "/";

    // Only allow same-site relative redirects (guard against open redirects).
    if (!next.startsWith("/") || next.startsWith("//")) {
      router.replace("/");
      return;
    }

    router.replace(next);
  }

  return (
    <main className="challengePage">
      <TrustChallengeInterstitial onComplete={handleComplete} />
    </main>
  );
}
