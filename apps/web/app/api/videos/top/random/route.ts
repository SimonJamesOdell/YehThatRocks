import { NextRequest, NextResponse } from "next/server";

import { filterHiddenVideos } from "@/lib/catalog-data";
import { getOptionalApiAuth } from "@/lib/auth-request";
import { getRandomTopVideo } from "@/lib/top-videos-cache";

const TOP_RANDOM_WAIT_MS = 1_100;

export async function GET(request: NextRequest) {
  const exclude = request.nextUrl.searchParams.get("exclude") ?? undefined;
  const result = await getRandomTopVideo({
    excludeVideoId: exclude,
    relatedCount: 24,
    waitMs: TOP_RANDOM_WAIT_MS,
  });

  // Filter blocked videos if user is authenticated
  const authResult = await getOptionalApiAuth(request);
  let relatedVideos = result.relatedVideos;
  if (authResult?.userId) {
    relatedVideos = await filterHiddenVideos(relatedVideos, authResult.userId);
  }

  return NextResponse.json({
    video: result.selected,
    relatedVideos,
  });
}
