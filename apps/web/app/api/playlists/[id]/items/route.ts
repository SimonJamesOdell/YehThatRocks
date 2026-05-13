import { NextRequest, NextResponse } from "next/server";

import { addPlaylistItemSchema, addPlaylistItemsBulkSchema, removePlaylistItemSchema, reorderPlaylistItemsSchema } from "@/lib/api-schemas";
import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import { addPlaylistItem, addPlaylistItems, filterHiddenVideos, removePlaylistItem, reorderPlaylistItems } from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

type PlaylistItemsRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: PlaylistItemsRouteContext) {
  const auth = await requireAuthOnly(request, { authMode: "user" });

  if (!auth.ok) {
    return auth.response;
  }

  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const { id } = await context.params;
  const bodyResult = await parseRequestJson(request);

  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const singleParsed = addPlaylistItemSchema.safeParse(bodyResult.data);

  if (singleParsed.success) {
    const playlist = await addPlaylistItem(id, singleParsed.data.videoId, auth.auth.userId);

    if (!playlist) {
      return NextResponse.json({ error: "Playlist or video not found" }, { status: 404 });
    }

    return NextResponse.json(playlist, { status: 201 });
  }

  const bulkParsed = addPlaylistItemsBulkSchema.safeParse(bodyResult.data);

  if (!bulkParsed.success) {
    return NextResponse.json({ error: bulkParsed.error.flatten() }, { status: 400 });
  }

  const uniqueVideoIds = Array.from(new Set(bulkParsed.data.videoIds));
  const playlist = await addPlaylistItems(id, uniqueVideoIds, auth.auth.userId);
  if (!playlist) {
    return NextResponse.json({ error: "Playlist or videos not found" }, { status: 404 });
  }

  playlist.videos = await filterHiddenVideos(playlist.videos, auth.auth.userId);

  return NextResponse.json(playlist, { status: 201 });
}

export async function DELETE(request: NextRequest, context: PlaylistItemsRouteContext) {
  const result = await withAuthAndBody(request, removePlaylistItemSchema, { authMode: "user" });

  if (!result.ok) {
    return result.response;
  }

  const { id } = await context.params;
  const playlist = await removePlaylistItem(
    id,
    result.data.playlistItemIndex ?? null,
    result.auth.userId,
    result.data.playlistItemId ?? null,
  );

  if (!playlist) {
    return NextResponse.json({ error: "Playlist item not found" }, { status: 404 });
  }

  playlist.videos = await filterHiddenVideos(playlist.videos, result.auth.userId);

  return NextResponse.json(playlist);
}

export async function PATCH(request: NextRequest, context: PlaylistItemsRouteContext) {
  const result = await withAuthAndBody(request, reorderPlaylistItemsSchema, { authMode: "user" });

  if (!result.ok) {
    return result.response;
  }

  const { id } = await context.params;
  const playlist = await reorderPlaylistItems(
    id,
    result.data.fromIndex ?? null,
    result.data.toIndex ?? null,
    result.auth.userId,
    result.data.fromPlaylistItemId ?? null,
    result.data.toPlaylistItemId ?? null,
  );

  if (!playlist) {
    return NextResponse.json({ error: "Playlist reorder failed" }, { status: 404 });
  }

  playlist.videos = await filterHiddenVideos(playlist.videos, result.auth.userId);

  return NextResponse.json(playlist);
}
