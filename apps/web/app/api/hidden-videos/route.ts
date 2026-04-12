import { NextRequest, NextResponse } from "next/server";

import { hiddenVideoMutationSchema } from "@/lib/api-schemas";
import { requireApiAuth } from "@/lib/auth-request";
import { getHiddenVideoIdsForUser, getHiddenVideosForUser, hideVideoAndPrunePlaylistsForUser, unhideVideoForUser } from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const limitRaw = request.nextUrl.searchParams.get("limit");
  const offsetRaw = request.nextUrl.searchParams.get("offset");
  const hasPaging = limitRaw !== null || offsetRaw !== null;

  if (hasPaging) {
    const parsedLimit = Number(limitRaw ?? "24");
    const parsedOffset = Number(offsetRaw ?? "0");
    const pageSize = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(100, Math.floor(parsedLimit))) : 24;
    const offset = Number.isFinite(parsedOffset) ? Math.max(0, Math.floor(parsedOffset)) : 0;

    const window = await getHiddenVideosForUser(authResult.auth.userId, {
      limit: pageSize + 1,
      offset,
    });

    const hasMore = window.length > pageSize;
    const blockedVideos = hasMore ? window.slice(0, pageSize) : window;
    const nextOffset = offset + blockedVideos.length;

    return NextResponse.json({
      blockedVideos,
      hasMore,
      nextOffset,
    });
  }

  const hiddenVideoIds = await getHiddenVideoIdsForUser(authResult.auth.userId);
  return NextResponse.json({ hiddenVideoIds: Array.from(hiddenVideoIds) });
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

  const parsed = hiddenVideoMutationSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const activePlaylistId = request.nextUrl.searchParams.get("activePlaylistId");

  const result = await hideVideoAndPrunePlaylistsForUser({
    userId: authResult.auth.userId,
    videoId: parsed.data.videoId,
    activePlaylistId,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "Failed to hide video" }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    removedItemCount: result.removedItemCount,
    removedFromPlaylistIds: result.removedFromPlaylistIds,
    deletedPlaylistIds: result.deletedPlaylistIds,
    activePlaylistDeleted: result.activePlaylistDeleted,
  });
}

export async function DELETE(request: NextRequest) {
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

  const parsed = hiddenVideoMutationSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await unhideVideoForUser({
    userId: authResult.auth.userId,
    videoId: parsed.data.videoId,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "Failed to unhide video" }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
