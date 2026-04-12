import { NextRequest, NextResponse } from "next/server";

import { watchHistoryEventSchema } from "@/lib/api-schemas";
import { requireApiAuth } from "@/lib/auth-request";
import { getHiddenVideoMatchesForUser, getWatchHistory, recordVideoWatch } from "@/lib/catalog-data";
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

  // Filter out blocked videos from history by checking the nested video property
  const hiddenIds = await getHiddenVideoMatchesForUser(
    authResult.auth.userId,
    historyWindow.map((entry) => entry.video.id),
  );
  const filteredHistory = historyWindow.filter((entry) => !hiddenIds.has(entry.video.id));

  const hasMore = filteredHistory.length > limit;
  const history = hasMore ? filteredHistory.slice(0, limit) : filteredHistory;
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

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to record watch history",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true });
}
