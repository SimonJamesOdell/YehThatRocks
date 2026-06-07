import { NextRequest, NextResponse } from "next/server";

// Optional shared secret to protect the endpoint from unauthenticated callers.
// Set CRON_SECRET in env; cron caller must send: Authorization: Bearer <CRON_SECRET>
const CRON_SECRET = process.env.CRON_SECRET?.trim() || "";
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

  return NextResponse.json({
    ok: true,
    skipped: true,
    reason: DISABLED_REASON,
  });
}

// Also accept GET so a simple curl or browser ping works alongside cron daemons
// that default to GET (e.g. Uptime Robot, UptimeKuma, cURL one-liners).
export const GET = POST;
