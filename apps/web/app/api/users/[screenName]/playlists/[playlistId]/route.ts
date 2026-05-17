import { NextRequest, NextResponse } from "next/server";

import { getPublicUserProfile, getPlaylistById } from "@/lib/catalog-data";
import { toJsonSafeValue } from "@/lib/json-safe";

type PlaylistRouteContext = {
  params: Promise<{ screenName: string; playlistId: string }>;
};

export async function GET(_request: NextRequest, context: PlaylistRouteContext) {
  const { screenName, playlistId } = await context.params;
  // App Router params are already decoded.
  const { user } = await getPublicUserProfile(screenName);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const playlist = await getPlaylistById(playlistId, user.id);

  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  return NextResponse.json(toJsonSafeValue(playlist));
}
