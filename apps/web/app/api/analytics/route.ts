import { NextRequest, NextResponse } from "next/server";

import { verifySameOrigin } from "@/lib/csrf";
import { isObviousCrawlerRequest, isBotRequest } from "@/lib/crawler-guard";
import { extractCfHeaders, cfHeadersSummary } from "@/lib/cf-headers";
import { prisma } from "@/lib/db";
import { readAuthCookies } from "@/lib/auth-cookies";
import { verifyToken } from "@/lib/auth-jwt";
import { parseRequestJson } from "@/lib/request-json";
import { rateLimitOrResponse, rateLimitSharedOrResponse } from "@/lib/rate-limit";
import { z } from "zod";

const schema = z.object({
  eventType: z.enum(["page_view", "video_view"]),
  visitorId: z.string().uuid(),
  sessionId: z.string().uuid(),
  videoId: z.string().max(32).optional(),
});

// Rate limit — per IP. 15 events per 5 min = 3/min.
// Normal human browsing: ~2-4 page views per minute, so 3/min gives
// comfortable headroom. A bot at 300/hr = 5/min = 25/5min gets blocked.
const ANALYTICS_RATE_LIMIT = 15;
const ANALYTICS_RATE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// Shared global cap — backstop against distributed attacks.
// 150 events per 5 min total across ALL IPs. Normal traffic peaks
// around 150-300 events/day; this allows 1,800/hr before the cap.
const ANALYTICS_GLOBAL_LIMIT = 150;

export async function POST(request: NextRequest) {
  // 1. Bot detection — combined UA + Cloudflare signals
  if (isBotRequest(request)) {
    return new NextResponse(null, { status: 204 });
  }

  // 2. CSRF check
  const csrfError = verifySameOrigin(request);
  if (csrfError) return csrfError;

  // 3. Rate limiting — per-IP, shared across all analytics event types
  const rateLimitResponse = rateLimitOrResponse(
    request,
    "analytics",
    ANALYTICS_RATE_LIMIT,
    ANALYTICS_RATE_WINDOW_MS,
  );
  if (rateLimitResponse) {
    // Log diagnostic info when rate limit triggers — helps identify attacker
    const cf = extractCfHeaders(request);
    console.warn(
      `[analytics] RATE LIMITED — ${cfHeadersSummary(cf)} UA="${request.headers.get("user-agent")?.slice(0, 120) ?? "none"}"`,
    );
    return rateLimitResponse;
  }

  // 3b. Shared global rate limit — catches distributed attacks across many IPs
  const globalLimitResponse = rateLimitSharedOrResponse(
    "analytics_global",
    ANALYTICS_GLOBAL_LIMIT,
    ANALYTICS_RATE_WINDOW_MS,
  );
  if (globalLimitResponse) {
    console.warn("[analytics] GLOBAL RATE LIMIT TRIGGERED — distributed attack suspected");
    return globalLimitResponse;
  }

  // 4. Parse and validate body
  const bodyResult = await parseRequestJson<unknown>(request);
  if (!bodyResult.ok) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const parsed = schema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { eventType, visitorId, sessionId, videoId } = parsed.data;

  // Resolve userId from auth cookie if present (optional — analytics works for anon visitors)
  let userId: number | null = null;
  try {
    const { accessToken } = readAuthCookies(request);
    if (accessToken) {
      const payload = await verifyToken(accessToken, "access");
      userId = payload.uid ?? null;
    }
  } catch {
    // Not logged in — fine
  }

  // Determine if this visitor has been seen before (all event types)
  const existing = await prisma.$queryRaw<Array<{ marker: number }>>`
    SELECT 1 AS marker
    FROM analytics_events
    WHERE visitor_id = ${visitorId}
    LIMIT 1
  `.catch(() => []);
  const isNewVisitor = existing.length === 0;

  await prisma.$executeRaw`
    INSERT INTO analytics_events (
      event_type,
      visitor_id,
      session_id,
      is_new_visitor,
      user_id,
      video_id,
      created_at
    )
    VALUES (
      ${eventType},
      ${visitorId},
      ${sessionId},
      ${isNewVisitor},
      ${userId},
      ${videoId ?? null},
      UTC_TIMESTAMP()
    )
  `.catch(() => null); // Fire-and-forget; don't fail the client if DB is down

  return NextResponse.json({ ok: true });
}
