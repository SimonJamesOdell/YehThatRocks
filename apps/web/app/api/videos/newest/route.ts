import { NextRequest, NextResponse } from "next/server";

import { getNewestVideos } from "@/lib/catalog-data";
import { clamp } from "@/lib/number-utils";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const skipParam = searchParams.get("skip");
  const takeParam = searchParams.get("take");

  const skip = Math.max(0, Number(skipParam ?? "0"));
  const take = clamp(Number(takeParam ?? "50"), 1, 200);
  const probeTake = clamp(take + 1, 0, 201);

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
