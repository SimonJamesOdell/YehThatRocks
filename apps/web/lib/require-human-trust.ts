import { NextRequest, NextResponse } from "next/server";

import type { AuthContext } from "@/lib/auth-request";
import { recordDenied } from "@/lib/trust-reputation";
import { getClientIp } from "@/lib/rate-limit";
import { resolveTrustTier, type AccountTrustSignals, type TrustTier } from "@/lib/trust-tier";

export const TRUST_REQUIRED_CODE = "TRUST_REQUIRED";

function isLoopbackIp(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
}

/**
 * Gate a sensitive endpoint behind the human-trust tiers.
 *
 * Returns null when the client meets the minimum tier; otherwise returns a 403
 * response carrying a machine-readable `TRUST_REQUIRED` code so the client can
 * solve the proof-of-work challenge and retry. The denial is recorded so abuse
 * becomes visible in the persisted reputation store.
 *
 * Loopback clients (local dev servers, smoke tests, on-box tooling) are not
 * bot-swarm targets and are allowed through without a challenge.
 */
export function requireHumanTrustOrResponse(
  request: NextRequest,
  auth: AuthContext | null,
  options: { minimumTier?: TrustTier; account?: AccountTrustSignals | null },
): NextResponse | null {
  if (isLoopbackIp(getClientIp(request))) {
    return null;
  }

  const minimumTier = options.minimumTier ?? 2;
  const assessment = resolveTrustTier(request, auth, options.account ?? null);

  if (assessment.tier >= minimumTier) {
    return null;
  }

  recordDenied(request);

  return NextResponse.json(
    {
      error: "Human verification required",
      code: TRUST_REQUIRED_CODE,
      minimumTier,
      tier: assessment.tier,
    },
    { status: 403 },
  );
}
