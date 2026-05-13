import { NextRequest, NextResponse } from "next/server";

import { createPlaylistSchema } from "@/lib/api-schemas";
import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import { createPlaylist, getPlaylists } from "@/lib/catalog-data";

export async function GET(request: NextRequest) {
  const auth = await requireAuthOnly(request, { authMode: "user" });

  if (!auth.ok) {
    return auth.response;
  }

  const playlists = await getPlaylists(auth.auth.userId);
  return NextResponse.json({ playlists });
}

export async function POST(request: NextRequest) {
  const result = await withAuthAndBody(request, createPlaylistSchema, { authMode: "user" });

  if (!result.ok) {
    return result.response;
  }

  try {
    const playlist = await createPlaylist(result.data.name, result.data.videoIds, result.auth.userId);
    return NextResponse.json(playlist, { status: 201 });
  } catch (error) {
    console.error("Failed to create playlist", error);
    const details = error instanceof Error ? error.message : String(error);

    return NextResponse.json(
      {
        error: "Failed to create playlist",
        ...(process.env.NODE_ENV !== "production" ? { details } : null),
      },
      { status: 500 },
    );
  }
}

