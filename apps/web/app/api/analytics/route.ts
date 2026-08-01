import { NextRequest, NextResponse } from "next/server";

import { verifySameOrigin } from "@/lib/csrf";
import { isObviousCrawlerRequest, isBotRequest } from "@/lib/crawler-guard";
import { extractCfHeaders, cfHeadersSummary } from "@/lib/cf-headers";
import { prisma } from "@/lib/db";
import { readAuthCookies } from "@/lib/auth-cookies";
import { verifyToken } from "@/lib/auth-jwt";
import { parseRequestJson } from "@/lib/request-json";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { z } from "zod";

const schema = z.object({
  eventType: z.enum(["page_view", "video_view"]),
  visitorId: z.string().uuid(),
  sessionId: z.string().uuid(),
  videoId: z.string().max(32).optional(),
});

// Rate limit: 100 analytics events per 5 minutes per IP.
// Well above normal human browsing (~20-30 pages in 5 min) but
// blocks the 300/hr bot pattern cold.
const ANALYTICS_RATE_LIMIT = 100;
const ANALYTICS_RATE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// Diagnostic threshold: log CF headers when a single IP sends
// more than this many requests in the window.
const DIAGNOSTIC_THRESHOLD = 50;

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
