import { NextRequest, NextResponse } from "next/server";

import { addPlaylistItemSchema, removePlaylistItemSchema, reorderPlaylistItemsSchema } from "@/lib/api-schemas";
import { requireApiAuth } from "@/lib/auth-request";
import { addPlaylistItem, filterHiddenVideos, removePlaylistItem, reorderPlaylistItems } from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

type PlaylistItemsRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: PlaylistItemsRouteContext) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
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

  const parsed = addPlaylistItemSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const playlist = await addPlaylistItem(id, parsed.data.videoId, authResult.auth.userId);

  if (!playlist) {
    return NextResponse.json({ error: "Playlist or video not found" }, { status: 404 });
  }

  return NextResponse.json(playlist, { status: 201 });
}

export async function DELETE(request: NextRequest, context: PlaylistItemsRouteContext) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
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

  const parsed = removePlaylistItemSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const playlist = await removePlaylistItem(
    id,
    parsed.data.playlistItemIndex ?? null,
    authResult.auth.userId,
    parsed.data.playlistItemId ?? null,
  );

  if (!playlist) {
    return NextResponse.json({ error: "Playlist item not found" }, { status: 404 });
  }

  playlist.videos = await filterHiddenVideos(playlist.videos, authResult.auth.userId);

  return NextResponse.json(playlist);
}

export async function PATCH(request: NextRequest, context: PlaylistItemsRouteContext) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
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

  const parsed = reorderPlaylistItemsSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const playlist = await reorderPlaylistItems(
    id,
    parsed.data.fromIndex ?? null,
    parsed.data.toIndex ?? null,
    authResult.auth.userId,
    parsed.data.fromPlaylistItemId ?? null,
    parsed.data.toPlaylistItemId ?? null,
  );

  if (!playlist) {
    return NextResponse.json({ error: "Playlist reorder failed" }, { status: 404 });
  }

  playlist.videos = await filterHiddenVideos(playlist.videos, authResult.auth.userId);

  return NextResponse.json(playlist);
}
