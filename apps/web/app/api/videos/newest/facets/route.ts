import { NextRequest, NextResponse } from "next/server";

import { getNewestVideos } from "@/lib/catalog-data";
import { clamp } from "@/lib/number-utils";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const windowParam = searchParams.get("window");
  const windowSize = clamp(Number(windowParam ?? "1000"), 50, 5000);

  try {
    const videos = await getNewestVideos(windowSize, 0, {
      enforcePlaybackAvailability: true,
    });

    const counts = new Map<string, number>();
    for (const video of videos) {
      const genre = (video.genre ?? "").trim();
      if (!genre) {
        continue;
      }

      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }

    const genres = [...counts.entries()]
      .map(([genre, count]) => ({ genre, count }))
      .sort((a, b) => (b.count - a.count) || a.genre.localeCompare(b.genre));

    return NextResponse.json({
      ok: true,
      window: windowSize,
      totalVideos: videos.length,
      genres,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to build newest genre facets",
      },
      { status: 500 },
    );
  }
}
