import { NextRequest } from "next/server";

import type { AuthContext } from "@/lib/auth-request";
import { isFlagged, isWarm } from "@/lib/trust-reputation";
import { verifyBotOkCookie } from "@/lib/trust";

const BOTOK_COOKIE = "ytr_botok";

/**
 * Four-tier human-confidence model.
 *
 *   TIER 3 — trusted human: authenticated AND (verified email OR account age ≥
 *            7 days) AND not anonymous. Never challenged.
 *   TIER 2 — evidenced client: valid proof-of-work cookie, warm IP activity,
 *            or an authenticated-but-low-confidence session. May act.
 *   TIER 1 — cold client: no evidence. Challenged before sensitive actions.
 *   TIER 0 — blocked: flagged IP. Refused outright.
 *
 * This supersedes the binary `assessHumanTrust` with account-confidence tiers.
 * The key change from before: an authenticated session alone is tier 2, not
 * tier 3 — confidence must be earned via verified email or account age, so a
 * freshly auto-registered account can never skip checks.
 */

export type TrustTier = 0 | 1 | 2 | 3;

export type AccountTrustSignals = {
  emailVerifiedAt: Date | string | number | null;
  createdAt: Date | string | number | null;
  isAnonymous: boolean | null;
};

export const TRUSTED_ACCOUNT_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Map account signals to a confidence tier. Pure — no request context.
 * Anonymous accounts never reach tier 3 (no verifiable identity).
 */
export function computeAccountTier(signals: AccountTrustSignals | null | undefined): 2 | 3 {
  if (!signals || signals.isAnonymous) {
    return 2;
  }

  const emailVerified = signals.emailVerifiedAt != null;
  const createdAtMs = signals.createdAt != null ? new Date(signals.createdAt).getTime() : null;
  const oldEnough = createdAtMs != null && Date.now() - createdAtMs >= TRUSTED_ACCOUNT_MIN_AGE_MS;

  return emailVerified || oldEnough ? 3 : 2;
}

export type TrustTierAssessment = {
  tier: TrustTier;
  reason: string;
};

/**
 * Resolve a client's confidence tier. Cheapest/strongest signals first, and
 * abuse history (flag) outranks every positive signal.
 */
export function resolveTrustTier(
  request: NextRequest,
  auth: AuthContext | null,
  account: AccountTrustSignals | null,
): TrustTierAssessment {
  if (isFlagged(request)) {
    return { tier: 0, reason: "flagged" };
  }

  if (auth && auth.userId != null) {
    return computeAccountTier(account) === 3
      ? { tier: 3, reason: "trusted-account" }
      : { tier: 2, reason: "authenticated" };
  }

  if (verifyBotOkCookie(request.cookies.get(BOTOK_COOKIE)?.value)) {
    return { tier: 2, reason: "proof-of-work" };
  }

  if (isWarm(request)) {
    return { tier: 2, reason: "warm-activity" };
  }

  return { tier: 1, reason: "cold" };
}
