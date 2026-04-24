import { NextRequest, NextResponse } from "next/server";

import { verifySameOrigin } from "@/lib/csrf";
import { isObviousCrawlerRequest } from "@/lib/crawler-guard";
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

const IP_GEO_CACHE_TTL_MS = 30 * 60 * 1000;
const ipGeoCache = new Map<string, { lat: number; lng: number; expiresAt: number }>();

function extractClientIp(request: NextRequest): string | null {
  const candidates = [
    request.headers.get("cf-connecting-ip"),
    request.headers.get("x-real-ip"),
    request.headers.get("x-forwarded-for"),
  ];

  for (const rawValue of candidates) {
    if (!rawValue) {
      continue;
    }

    const first = rawValue.split(",")[0]?.trim();
    if (!first) {
      continue;
    }

    if (first === "::1") {
      return "127.0.0.1";
    }

    if (first.startsWith("::ffff:")) {
      return first.slice(7);
    }

    // For IPv4 with appended port, keep only IP part.
    if (first.includes(".") && first.includes(":")) {
      const maybeIpv4 = first.split(":")[0]?.trim();
      if (maybeIpv4) {
        return maybeIpv4;
      }
    }

    return first;
  }

  return null;
}

function isPublicIp(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "127.0.0.1" || normalized === "::1") {
    return false;
  }

  if (normalized.includes(":")) {
    return !normalized.startsWith("fc") && !normalized.startsWith("fd") && !normalized.startsWith("fe80:");
  }

  const octets = normalized.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = octets;
  if (a === 10 || a === 127) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  return true;
}

async function inferGeoFromRequest(request: NextRequest): Promise<{ lat: number; lng: number } | null> {
  const clientIp = extractClientIp(request);
  if (!clientIp || !isPublicIp(clientIp)) {
    return null;
  }

  const now = Date.now();
  const cached = ipGeoCache.get(clientIp);
  if (cached && cached.expiresAt > now) {
    return { lat: cached.lat, lng: cached.lng };
  }

  try {
    const response = await fetch(`https://ipapi.co/${encodeURIComponent(clientIp)}/json/`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(1800),
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as { latitude?: unknown; longitude?: unknown };
    const lat = Number(payload.latitude);
    const lng = Number(payload.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    ipGeoCache.set(clientIp, {
      lat,
      lng,
      expiresAt: now + IP_GEO_CACHE_TTL_MS,
    });

    return { lat, lng };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (isObviousCrawlerRequest(request)) {
    return new NextResponse(null, { status: 204 });
  }

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

  let resolvedGeoLat = geoLat ?? null;
  let resolvedGeoLng = geoLng ?? null;
  let resolvedGeoAccuracyMeters = geoAccuracyMeters ?? null;

  if (resolvedGeoLat === null || resolvedGeoLng === null) {
    const inferredGeo = await inferGeoFromRequest(request);
    if (inferredGeo) {
      resolvedGeoLat = inferredGeo.lat;
      resolvedGeoLng = inferredGeo.lng;
      resolvedGeoAccuracyMeters = resolvedGeoAccuracyMeters ?? null;
    }
  }

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
      ${resolvedGeoLat},
      ${resolvedGeoLng},
      ${resolvedGeoAccuracyMeters},
      UTC_TIMESTAMP()
    )
  `.catch(() => null); // Fire-and-forget; don't fail the client if DB is down

  return NextResponse.json({ ok: true });
}
