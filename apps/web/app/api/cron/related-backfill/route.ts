import { NextRequest, NextResponse } from "next/server";

// Optional shared secret to protect the endpoint from unauthenticated callers.
// Set CRON_SECRET in env; cron caller must send: Authorization: Bearer <CRON_SECRET>
const CRON_SECRET = process.env.CRON_SECRET?.trim() || "";
// This cron was deprecated and removed. Return 410 to avoid accidental re-use.
// Keep the legacy disabled reason string so verification/invariants remain stable.
const DISABLED_REASON = "disabled-manual-submissions-only";

function isCronAuthorized(request: NextRequest): boolean {
  if (!CRON_SECRET) {
    // No secret configured — only allow requests from localhost / loopback.
    const forwarded = request.headers.get("x-forwarded-for");
    const realIp = request.headers.get("x-real-ip");
    const ip = forwarded?.split(",")[0]?.trim() ?? realIp ?? "";
    return ip === "" || ip === "127.0.0.1" || ip === "::1";
  }

  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token.length > 0 && token === CRON_SECRET;
}

const HTTP_UNAUTHORIZED = 401;

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: HTTP_UNAUTHORIZED });
  }

  // Intentionally removed: ensure callers cannot re-enable this expensive
  // automated backfill by returning 410 Gone. Keep the auth guard above so
  // the endpoint still enforces the original access model for manual checks.
  return NextResponse.json({
    ok: false,
    error: "Related backfill permanently removed",
    reason: DISABLED_REASON,
  }, {
    status: 410,
  });
}

// Also accept GET so a simple curl or browser ping works alongside cron daemons
// that default to GET (e.g. Uptime Robot, UptimeKuma, cURL one-liners).
export const GET = POST;
