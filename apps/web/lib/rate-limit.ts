import { NextRequest, NextResponse } from "next/server";

type RateEntry = {
  count: number;
  resetAt: number;
};

// IP-scoped bucket — keyed by "<ip>:<suffix>"
const ipBucket = new Map<string, RateEntry>();

// Shared bucket — keyed by suffix only, not IP (for room-level caps)
const sharedBucket = new Map<string, RateEntry>();

const PRUNE_INTERVAL_MS = 60_000;
let lastPrunedAt = 0;

function pruneExpiredEntries(now: number) {
  if (now - lastPrunedAt < PRUNE_INTERVAL_MS) {
    return;
  }
  lastPrunedAt = now;
  for (const [key, entry] of ipBucket) {
    if (now >= entry.resetAt) ipBucket.delete(key);
  }
  for (const [key, entry] of sharedBucket) {
    if (now >= entry.resetAt) sharedBucket.delete(key);
  }
}

function getClientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return "unknown";
}

function checkBucket(
  map: Map<string, RateEntry>,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): NextResponse | null {
  const current = map.get(key);

  if (!current || now >= current.resetAt) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (current.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  current.count += 1;
  map.set(key, current);
  return null;
}

/** Per-IP rate limit. Use for per-user actions keyed on network identity. */
export function rateLimitOrResponse(
  request: NextRequest,
  keySuffix: string,
  limit: number,
  windowMs: number,
): NextResponse | null {
  const now = Date.now();
  pruneExpiredEntries(now);
  const key = `${getClientIp(request)}:${keySuffix}`;
  return checkBucket(ipBucket, key, limit, windowMs, now);
}

/** Shared rate limit — not scoped to any IP. Use for global room/resource caps. */
export function rateLimitSharedOrResponse(
  key: string,
  limit: number,
  windowMs: number,
): NextResponse | null {
  const now = Date.now();
  pruneExpiredEntries(now);
  return checkBucket(sharedBucket, key, limit, windowMs, now);
}
