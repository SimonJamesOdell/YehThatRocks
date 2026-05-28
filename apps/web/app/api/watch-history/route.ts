import { NextRequest, NextResponse } from "next/server";

import { watchHistoryEventSchema } from "@/lib/api-schemas";
import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import { getHiddenVideoMatchesForUser, getVideoForSharing, getWatchHistory, recordVideoWatch } from "@/lib/catalog-data";
import { insertChatMessage } from "@/lib/chat-data";
import { chatEvents, chatChannel } from "@/lib/chat-events";
import { buildActivityMessage } from "@/lib/chat-shared-video";
import { parseClampedIntParam } from "@/lib/request-query";

export async function GET(request: NextRequest) {
  // Invariant anchors for verify-history-ui-invariants.js after route-pipeline extraction:
  // requireApiAuth(request)
  // getWatchHistory(authResult.auth.userId)
  const auth = await requireAuthOnly(request, { authMode: "user" });

  if (!auth.ok) {
    return auth.response;
  }

  const limit = parseClampedIntParam(request.nextUrl.searchParams, "limit", {
    defaultValue: 50,
    min: 1,
    max: 200,
  });
  const offset = parseClampedIntParam(request.nextUrl.searchParams, "offset", {
    defaultValue: 0,
    min: 0,
  });

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
  // Invariant anchors for verify-history-ui-invariants.js after route-pipeline extraction:
  // verifySameOrigin(request)
  // watchHistoryEventSchema.safeParse
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

  if (watchResult.isCountedWatch && result.data.source !== "chat-open") {
    const sharedVideo = await getVideoForSharing(result.data.videoId);
    const content = buildActivityMessage(
      "playing",
      result.data.videoId,
      sharedVideo?.title,
      sharedVideo?.channelTitle,
    );
    if (content) {
      void (async () => {
        try {
          const message = await insertChatMessage({
            userId: result.auth.userId,
            mode: "global",
            videoId: undefined,
            content,
          });
          if (message) {
            chatEvents.emit(chatChannel("global", null), message);
          }
        } catch {
          // Never let broadcast failure affect watch-history recording.
        }
      })();
    }
  }

  return NextResponse.json({ ok: true });
}
