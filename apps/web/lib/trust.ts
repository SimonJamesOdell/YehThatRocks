import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

import type { AuthContext } from "@/lib/auth-request";
import { isFlagged, isWarm, recordBenignActivity } from "@/lib/trust-reputation";

/**
 * Human-trust gate for sensitive, mutable endpoints.
 *
 * A distributed residential-proxy botnet rotates thousands of fresh IPs, so
 * per-IP rate limits and static user-agent checks alone can't stop it. This
 * module instead asks a cheaper question: "have we accumulated evidence that
 * this client is a human?" Evidence accumulates over time:
 *
 *   - an authenticated account (registered → already proved a human);
 *   - a solved client-side proof-of-work challenge (`ytr_botok` cookie);
 *   - repeated benign browsing from the same IP across a meaningful time span.
 *
 * A brand-new IP that goes straight for a sensitive endpoint fails all three,
 * so it is denied. A human who has been browsing the site for a couple of
 * minutes (or who signed in / solved the challenge) is allowed. Either way the
 * normal rate limits still apply.
 *
 * The warm-activity signal is now persisted (lib/trust-reputation.ts) so it
 * survives restarts; this module keeps the synchronous assessment and the
 * proof-of-work cookie verification.
 */

const BOTOK_COOKIE = "ytr_botok";
const BOTOK_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function botokSecret(): string {
  return process.env.AUTH_JWT_SECRET ?? "ytr-botok-dev-secret";
}

/**
 * Verify a `ytr_botok` proof-of-work cookie (issued by /api/bot-challenge).
 * The cookie is `nonce:issuedAtSeconds:hmac` with the HMAC over
 * `ytr-botok:nonce:issuedAtSeconds`. This is the server-side counterpart to
 * `signBotOkCookie` and was previously missing, which meant the challenge was
 * issued but never trusted downstream.
 */
export function verifyBotOkCookie(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const parts = value.split(":");
  if (parts.length !== 3) {
    return false;
  }

  const [nonce, issuedAtRaw, sig] = parts;
  if (!nonce || !/^[0-9a-f]{1,128}$/i.test(nonce)) {
    return false;
  }

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) {
    return false;
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - issuedAt;
  if (ageSeconds < 0 || ageSeconds > BOTOK_MAX_AGE_SECONDS) {
    return false;
  }

  const expected = createHmac("sha256", botokSecret())
    .update(`ytr-botok:${nonce}:${issuedAtRaw}`)
    .digest();

  const provided = Buffer.from(sig, "hex");
  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(expected, provided);
}

/**
 * Record that a client made a benign (read-only) request. Call this from the
 * high-traffic public read endpoints that a human hits while browsing.
 */
export function noteBenignActivity(request: Request): void {
  recordBenignActivity(request);
}

export type TrustReason =
  | "authenticated"
  | "proof-of-work"
  | "warm-activity"
  | "flagged"
  | "insufficient";

export type TrustAssessment = {
  trusted: boolean;
  reason: TrustReason;
};

/**
 * Decide whether a client has accumulated enough evidence of being human to
 * use a sensitive endpoint. Cheapest/strongest signals are checked first.
 *
 * A flagged IP is refused outright before any evidence is considered — abuse
 * history outranks a solved cookie or a warm IP.
 */
export function assessHumanTrust(request: NextRequest, auth: AuthContext | null): TrustAssessment {
  if (isFlagged(request)) {
    return { trusted: false, reason: "flagged" };
  }

  if (auth && auth.userId != null) {
    return { trusted: true, reason: "authenticated" };
  }

  if (verifyBotOkCookie(request.cookies.get(BOTOK_COOKIE)?.value)) {
    return { trusted: true, reason: "proof-of-work" };
  }

  if (isWarm(request)) {
    return { trusted: true, reason: "warm-activity" };
  }

  return { trusted: false, reason: "insufficient" };
}
