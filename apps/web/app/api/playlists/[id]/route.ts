import { NextRequest, NextResponse } from "next/server";

import { renamePlaylistSchema } from "@/lib/api-schemas";
import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import { deletePlaylist, filterHiddenVideos, getPlaylistById, getPlaylists, renamePlaylist } from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";

export const dynamic = "force-dynamic";

function withNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

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
  const auth = await requireAuthOnly(_request, { authMode: "user" });

  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  let playlist = await getPlaylistById(id, auth.auth.userId);

  if (playlist) {
    // Filter out blocked videos from playlist
    playlist.videos = await filterHiddenVideos(playlist.videos, auth.auth.userId);
    return withNoStore(NextResponse.json(toJsonSafeValue({
      ...playlist,
      itemCount: playlist.videos.length,
    })));
  }

  // Some database shapes fail to resolve empty playlists in detail lookup.
  // Fall back to summary lookup so zero-track playlists still open correctly.
  const playlistSummaries = await getPlaylists(auth.auth.userId);
  const matchingSummary = playlistSummaries.find((candidate) => candidate.id === id);

  if (!matchingSummary) {
    return withNoStore(NextResponse.json({ error: "Playlist not found" }, { status: 404 }));
  }

  return withNoStore(NextResponse.json(toJsonSafeValue({
    id: matchingSummary.id,
    name: matchingSummary.name,
    videos: [],
    itemCount: matchingSummary.itemCount,
  })));
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
