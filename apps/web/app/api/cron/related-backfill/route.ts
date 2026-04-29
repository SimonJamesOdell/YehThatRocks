import { NextRequest, NextResponse } from "next/server";

import { hasDatabaseUrl, runQuotaBackfill } from "@/lib/catalog-data";

// Budget per cron run in YouTube API units. Each related call costs 100 units.
// Default 300 = 3 related pulls per trigger. Override via AUTO_RELATED_BACKFILL_UNITS_PER_RUN.
const UNITS_PER_RUN = Math.max(100, Math.min(10_000, Number(process.env.AUTO_RELATED_BACKFILL_UNITS_PER_RUN || "300")));

// Optional shared secret to protect the endpoint from unauthenticated callers.
// Set CRON_SECRET in env; cron caller must send: Authorization: Bearer <CRON_SECRET>
const CRON_SECRET = process.env.CRON_SECRET?.trim() || "";

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

  if (!hasDatabaseUrl()) {
    return NextResponse.json({ ok: false, skipped: true, reason: "no-database" });
  }

  try {
    const result = await runQuotaBackfill(UNITS_PER_RUN);

    return NextResponse.json({
      ok: true,
      seedsAttempted: result.seedsAttempted,
      fetchedNodes: result.fetchedNodes,
      discoveredNewVideos: result.discoveredNewVideos,
      unitsEstimated: result.unitsEstimated,
      unitsPerRun: UNITS_PER_RUN,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Backfill failed." },
      { status: 500 },
    );
  }
}

// Also accept GET so a simple curl or browser ping works alongside cron daemons
// that default to GET (e.g. Uptime Robot, UptimeKuma, cURL one-liners).
export const GET = POST;
