import { NextRequest, NextResponse } from "next/server";

import { watchHistoryEventSchema } from "@/lib/api-schemas";
import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import { getHiddenVideoMatchesForUser, getWatchHistory, recordVideoWatch } from "@/lib/catalog-data";

export async function GET(request: NextRequest) {
  const auth = await requireAuthOnly(request, { authMode: "user" });

  if (!auth.ok) {
    return auth.response;
  }

  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "50");
  const requestedOffset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
  const limit = Math.max(1, Math.min(200, Math.floor(Number.isFinite(requestedLimit) ? requestedLimit : 50)));
  const offset = Math.max(0, Math.floor(Number.isFinite(requestedOffset) ? requestedOffset : 0));

  const historyWindow = await getWatchHistory(auth.auth.userId, {
    limit: limit + 1,
    offset,
  });

  // Filter out blocked videos from history by checking the nested video property
  const hiddenIds = await getHiddenVideoMatchesForUser(
    auth.auth.userId,
    historyWindow.map((entry) => entry.video.id),
  );
  const filteredHistory = historyWindow.filter((entry) => !hiddenIds.has(entry.video.id));

  const hasMore = filteredHistory.length > limit;
  const history = hasMore ? filteredHistory.slice(0, limit) : filteredHistory;
  const nextOffset = offset + history.length;

  return NextResponse.json({ history, hasMore, nextOffset });
}

export async function POST(request: NextRequest) {
  const result = await withAuthAndBody(request, watchHistoryEventSchema, { authMode: "user" });

  if (!result.ok) {
    return result.response;
  }

  const watchResult = await recordVideoWatch({
    userId: result.auth.userId,
    videoId: result.data.videoId,
    reason: result.data.reason,
    positionSec: result.data.positionSec,
    durationSec: result.data.durationSec,
    progressPercent: result.data.progressPercent,
  });

  if (!watchResult.ok) {
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
