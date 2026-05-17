import { NextRequest, NextResponse } from "next/server";

import { renamePlaylistSchema } from "@/lib/api-schemas";
import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import { deletePlaylist, filterHiddenVideos, getPlaylistById, getPlaylists, renamePlaylist } from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { toJsonSafeValue } from "@/lib/json-safe";

export const dynamic = "force-dynamic";

type PlaylistRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: PlaylistRouteContext) {
  const auth = await requireAuthOnly(_request, { authMode: "user" });

  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  let playlist = await getPlaylistById(id, auth.auth.userId);

  if (playlist) {
    // Filter out blocked videos from playlist
    playlist.videos = await filterHiddenVideos(playlist.videos, auth.auth.userId);
    const response = NextResponse.json(toJsonSafeValue({
      ...playlist,
      itemCount: playlist.videos.length,
    }));
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    return response;
  }

  // Some database shapes fail to resolve empty playlists in detail lookup.
  // Fall back to summary lookup so zero-track playlists still open correctly.
  const playlistSummaries = await getPlaylists(auth.auth.userId);
  const matchingSummary = playlistSummaries.find((candidate) => candidate.id === id);

  if (!matchingSummary) {
    const response = NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    return response;
  }

  const response = NextResponse.json(toJsonSafeValue({
    id: matchingSummary.id,
    name: matchingSummary.name,
    videos: [],
    itemCount: matchingSummary.itemCount,
  }));
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

export async function DELETE(request: NextRequest, context: PlaylistRouteContext) {
  const auth = await requireAuthOnly(request, { authMode: "user" });

  if (!auth.ok) {
    return auth.response;
  }

  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const { id } = await context.params;
  const didDelete = await deletePlaylist(id, auth.auth.userId);

  if (!didDelete) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest, context: PlaylistRouteContext) {
  const result = await withAuthAndBody(request, renamePlaylistSchema, { authMode: "user" });

  if (!result.ok) {
    return result.response;
  }

  const { id } = await context.params;
  const renamed = await renamePlaylist(id, result.data.name, result.auth.userId);

  if (!renamed) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
