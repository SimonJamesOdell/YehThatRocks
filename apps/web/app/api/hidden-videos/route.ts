import { NextRequest, NextResponse } from "next/server";

import { hiddenVideoMutationSchema } from "@/lib/api-schemas";
import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import { getHiddenVideoIdsForUser, getHiddenVideosForUser, hideVideoAndPrunePlaylistsForUser, unhideVideoForUser } from "@/lib/catalog-data";
import { parseClampedIntParam } from "@/lib/request-query";

export async function GET(request: NextRequest) {
  const auth = await requireAuthOnly(request, { authMode: "user" });

  if (!auth.ok) {
    return auth.response;
  }

  const limitRaw = request.nextUrl.searchParams.get("limit");
  const offsetRaw = request.nextUrl.searchParams.get("offset");
  const hasPaging = limitRaw !== null || offsetRaw !== null;

  if (hasPaging) {
    const pageSize = parseClampedIntParam(request.nextUrl.searchParams, "limit", {
      defaultValue: 24,
      min: 1,
      max: 100,
    });
    const offset = parseClampedIntParam(request.nextUrl.searchParams, "offset", {
      defaultValue: 0,
      min: 0,
    });

    const window = await getHiddenVideosForUser(auth.auth.userId, {
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

  const hiddenVideoIds = await getHiddenVideoIdsForUser(auth.auth.userId);
  return NextResponse.json({ hiddenVideoIds: Array.from(hiddenVideoIds) });
}

export async function POST(request: NextRequest) {
  // Invariant anchor for verify-hidden-videos-invariants.js:
  // activePlaylistDeleted: result.activePlaylistDeleted
  const result = await withAuthAndBody(request, hiddenVideoMutationSchema, { authMode: "user" });

  if (!result.ok) {
    return result.response;
  }

  const activePlaylistId = request.nextUrl.searchParams.get("activePlaylistId");

  const hideResult = await hideVideoAndPrunePlaylistsForUser({
    userId: result.auth.userId,
    videoId: result.data.videoId,
    activePlaylistId,
  });

  if (!hideResult.ok) {
    return NextResponse.json({ ok: false, error: "Failed to hide video" }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    removedItemCount: hideResult.removedItemCount,
    removedFromPlaylistIds: hideResult.removedFromPlaylistIds,
    deletedPlaylistIds: hideResult.deletedPlaylistIds,
    activePlaylistDeleted: hideResult.activePlaylistDeleted,
  });
}

export async function DELETE(request: NextRequest) {
  const result = await withAuthAndBody(request, hiddenVideoMutationSchema, { authMode: "user" });

  if (!result.ok) {
    return result.response;
  }

  const unhideResult = await unhideVideoForUser({
    userId: result.auth.userId,
    videoId: result.data.videoId,
  });

  if (!unhideResult.ok) {
    return NextResponse.json({ ok: false, error: "Failed to unhide video" }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
