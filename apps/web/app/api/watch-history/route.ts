import { NextRequest, NextResponse } from "next/server";

import { watchHistoryEventSchema } from "@/lib/api-schemas";
import { requireApiAuth } from "@/lib/auth-request";
import { getWatchHistory, recordVideoWatch } from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "50");
  const requestedOffset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
  const limit = Math.max(1, Math.min(200, Math.floor(Number.isFinite(requestedLimit) ? requestedLimit : 50)));
  const offset = Math.max(0, Math.floor(Number.isFinite(requestedOffset) ? requestedOffset : 0));

  const historyWindow = await getWatchHistory(authResult.auth.userId, {
    limit: limit + 1,
    offset,
  });

  const hasMore = historyWindow.length > limit;
  const history = hasMore ? historyWindow.slice(0, limit) : historyWindow;
  const nextOffset = offset + history.length;

  return NextResponse.json({ history, hasMore, nextOffset });
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const bodyResult = await parseRequestJson(request);

  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = watchHistoryEventSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await recordVideoWatch({
    userId: authResult.auth.userId,
    videoId: parsed.data.videoId,
    reason: parsed.data.reason,
    positionSec: parsed.data.positionSec,
    durationSec: parsed.data.durationSec,
    progressPercent: parsed.data.progressPercent,
  });

  return NextResponse.json({ ok: result.ok });
}
