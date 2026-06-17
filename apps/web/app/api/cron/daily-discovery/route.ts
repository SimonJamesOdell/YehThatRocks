import { NextRequest, NextResponse } from "next/server";

import { maybeStartAutomaticRelatedBackfill } from "@/lib/catalog-data";

const CRON_SECRET = process.env.CRON_SECRET?.trim() || "";

function isCronAuthorized(request: NextRequest): boolean {
  if (!CRON_SECRET) {
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

  const offset = Math.max(0, Number(request.nextUrl.searchParams.get("offset") || "0"));

  // Fire-and-forget: start the backfill and return immediately.
  maybeStartAutomaticRelatedBackfill(offset);

  return NextResponse.json({
    ok: true,
    message: "Automated daily discovery started.",
    offset,
  });
}

// Also accept GET so a simple curl or browser ping works alongside cron daemons
// that default to GET (e.g. Uptime Robot, UptimeKuma, cURL one-liners).
export const GET = POST;
