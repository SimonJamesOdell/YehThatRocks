import { NextRequest, NextResponse } from "next/server";

import { getLyricsForVideo } from "@/lib/lyrics";

export async function GET(request: NextRequest) {
  try {
    const rawVideoId = request.nextUrl.searchParams.get("v");
    const result = await getLyricsForVideo(rawVideoId);

    if (!result.ok) {
      return NextResponse.json({ error: result.message ?? "Could not load lyrics." }, { status: result.status });
    }

    return NextResponse.json({
      videoId: result.videoId,
      artistName: result.artistName ?? null,
      trackName: result.trackName ?? null,
      lyrics: result.plainLyrics ?? null,
      source: result.source ?? null,
      cached: Boolean(result.cached),
      available: Boolean(result.plainLyrics),
      message: result.message ?? null,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not retrieve lyrics due to a server error. Please try again." },
      { status: 500 },
    );
  }
}
