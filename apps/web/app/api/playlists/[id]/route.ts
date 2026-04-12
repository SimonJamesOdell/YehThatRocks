import { NextRequest, NextResponse } from "next/server";

import { renamePlaylistSchema } from "@/lib/api-schemas";
import { requireApiAuth } from "@/lib/auth-request";
import { deletePlaylist, filterHiddenVideos, getPlaylistById, getPlaylists, renamePlaylist } from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

type PlaylistRouteContext = {
  params: Promise<{ id: string }>;
};

function toJsonSafeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonSafeValue(entry));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      toJsonSafeValue(entry),
    ]);
    return Object.fromEntries(entries);
  }

  return value;
}

export async function GET(_request: NextRequest, context: PlaylistRouteContext) {
  const authResult = await requireApiAuth(_request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const { id } = await context.params;
  let playlist = await getPlaylistById(id, authResult.auth.userId);

  if (playlist) {
    // Filter out blocked videos from playlist
    playlist.videos = await filterHiddenVideos(playlist.videos, authResult.auth.userId);
    return NextResponse.json(toJsonSafeValue({
      ...playlist,
      itemCount: playlist.videos.length,
    }));
  }

  // Some database shapes fail to resolve empty playlists in detail lookup.
  // Fall back to summary lookup so zero-track playlists still open correctly.
  const playlistSummaries = await getPlaylists(authResult.auth.userId);
  const matchingSummary = playlistSummaries.find((candidate) => candidate.id === id);

  if (!matchingSummary) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  return NextResponse.json(toJsonSafeValue({
    id: matchingSummary.id,
    name: matchingSummary.name,
    videos: [],
    itemCount: matchingSummary.itemCount,
  }));
}

export async function DELETE(request: NextRequest, context: PlaylistRouteContext) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const { id } = await context.params;
  const didDelete = await deletePlaylist(id, authResult.auth.userId);

  if (!didDelete) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest, context: PlaylistRouteContext) {
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

  const parsed = renamePlaylistSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { id } = await context.params;
  const renamed = await renamePlaylist(id, parsed.data.name, authResult.auth.userId);

  if (!renamed) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
