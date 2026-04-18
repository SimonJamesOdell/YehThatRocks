import { NextRequest, NextResponse } from "next/server";

import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { readAuthCookies } from "@/lib/auth-cookies";
import { verifyToken } from "@/lib/auth-jwt";
import { z } from "zod";

const schema = z.object({
  eventType: z.enum(["page_view", "video_view"]),
  visitorId: z.string().uuid(),
  sessionId: z.string().uuid(),
  videoId: z.string().max(32).optional(),
  geoLat: z.number().min(-90).max(90).optional(),
  geoLng: z.number().min(-180).max(180).optional(),
  geoAccuracyMeters: z.number().min(0).max(1_000_000).optional(),
});

export async function POST(request: NextRequest) {
  const csrfError = verifySameOrigin(request);
  if (csrfError) return csrfError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { eventType, visitorId, sessionId, videoId, geoLat, geoLng, geoAccuracyMeters } = parsed.data;

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

  // For page_view events, determine if this visitor has been seen before
  let isNewVisitor = false;
  if (eventType === "page_view") {
    const existing = await prisma.$queryRaw<Array<{ marker: number }>>`
      SELECT 1 AS marker
      FROM analytics_events
      WHERE visitor_id = ${visitorId}
      LIMIT 1
    `.catch(() => []);
    isNewVisitor = existing.length === 0;
  }

  await prisma.$executeRaw`
    INSERT INTO analytics_events (
      event_type,
      visitor_id,
      session_id,
      is_new_visitor,
      user_id,
      video_id,
      geo_lat,
      geo_lng,
      geo_accuracy_m,
      created_at
    )
    VALUES (
      ${eventType},
      ${visitorId},
      ${sessionId},
      ${isNewVisitor},
      ${userId},
      ${videoId ?? null},
      ${geoLat ?? null},
      ${geoLng ?? null},
      ${geoAccuracyMeters ?? null},
      UTC_TIMESTAMP()
    )
  `.catch(() => null); // Fire-and-forget; don't fail the client if DB is down

  return NextResponse.json({ ok: true });
}
