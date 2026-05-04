import { NextRequest, NextResponse } from "next/server";

import { getOptionalApiAuth, requireApiAuth } from "@/lib/auth-request";
import { chatQuerySchema, createChatMessageSchema } from "@/lib/api-schemas";
import { chatChannel, chatEvents } from "@/lib/chat-events";
import {
  fetchChatMessages,
  fetchOnlineUsers,
  insertChatMessage,
  touchOnlinePresenceThrottled,
} from "@/lib/chat-data";
import { verifySameOrigin } from "@/lib/csrf";
import { rateLimitOrResponse, rateLimitSharedOrResponse } from "@/lib/rate-limit";
import { parseRequestJson } from "@/lib/request-json";

export async function GET(request: NextRequest) {
  const authContext = await getOptionalApiAuth(request);

  const parsedQuery = chatQuerySchema.safeParse({
    mode: request.nextUrl.searchParams.get("mode") ?? undefined,
    videoId: request.nextUrl.searchParams.get("videoId") ?? undefined,
  });

  if (!parsedQuery.success) {
    return NextResponse.json({ error: parsedQuery.error.flatten() }, { status: 400 });
  }

  const { mode, videoId } = parsedQuery.data;

  if (mode === "online" && !authContext) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (authContext) {
    await touchOnlinePresenceThrottled(authContext.userId).catch(() => undefined);
  }

  if (mode === "online") {
    const onlineUsers = await fetchOnlineUsers(authContext!.userId);
    return NextResponse.json({
      mode,
      videoId: null,
      messages: [],
      onlineUsers,
    });
  }

  if (mode === "video" && !videoId) {
    return NextResponse.json({ error: "videoId is required for video chat" }, { status: 400 });
  }

  const messages = await fetchChatMessages(mode, videoId);
  return NextResponse.json({
    mode,
    videoId: videoId ?? null,
    messages,
  });
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

  await touchOnlinePresenceThrottled(authResult.auth.userId).catch(() => undefined);

  const bodyResult = await parseRequestJson(request);

  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsedBody = createChatMessageSchema.safeParse(bodyResult.data);

  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.flatten() }, { status: 400 });
  }

  const { content, mode, videoId } = parsedBody.data;

  if (mode === "global") {
    // Per-user: max 4 messages per 30 seconds (~1 every 7.5s sustained)
    const userRateLimited = rateLimitOrResponse(
      request,
      `chat:global:user:${authResult.auth.userId}`,
      4,
      30 * 1000,
    );
    if (userRateLimited) {
      return userRateLimited;
    }

    // Room-level cap: max 60 messages per minute across ALL users combined
    const roomRateLimited = rateLimitSharedOrResponse("chat:global:room", 60, 60 * 1000);
    if (roomRateLimited) {
      return roomRateLimited;
    }
  }

  if (mode === "video" && !videoId) {
    return NextResponse.json({ error: "videoId is required for video chat" }, { status: 400 });
  }

  if (mode === "video") {
    // Per-user cap inside a single video room.
    const userRateLimited = rateLimitOrResponse(
      request,
      `chat:video:user:${authResult.auth.userId}:${videoId}`,
      6,
      30 * 1000,
    );
    if (userRateLimited) {
      return userRateLimited;
    }

    // Per-room cap for each video chat room.
    const roomRateLimited = rateLimitSharedOrResponse(`chat:video:room:${videoId}`, 90, 60 * 1000);
    if (roomRateLimited) {
      return roomRateLimited;
    }
  }

  const mapped = await insertChatMessage({
    userId: authResult.auth.userId,
    mode,
    videoId,
    content,
  });

  if (!mapped) {
    return NextResponse.json({ error: "Failed to create message" }, { status: 500 });
  }

  chatEvents.emit(chatChannel(mode, mode === "video" ? (videoId ?? null) : null), mapped);
  return NextResponse.json({ ok: true, message: mapped }, { status: 201 });
}
