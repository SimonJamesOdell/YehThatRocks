import { NextRequest, NextResponse } from "next/server";

import { getNewestVideos } from "@/lib/catalog-data";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const skipParam = searchParams.get("skip");
  const takeParam = searchParams.get("take");

  const skip = Math.max(0, Number(skipParam ?? "0"));
  const take = Math.max(1, Math.min(200, Number(takeParam ?? "50")));
  const probeTake = Math.min(201, take + 1);

  try {
    const probedVideos = await getNewestVideos(probeTake, skip, {
      enforcePlaybackAvailability: true,
    });

    const hasMore = probedVideos.length > take;
    const videos = hasMore ? probedVideos.slice(0, take) : probedVideos;
    const nextOffset = skip + videos.length;

    return NextResponse.json({
      ok: true,
      videos,
      skip,
      take,
      hasMore,
      nextOffset,
      count: videos.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to fetch newest videos",
      },
      { status: 500 },
    );
  }
}
