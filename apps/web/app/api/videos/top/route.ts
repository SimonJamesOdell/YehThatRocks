import { NextRequest, NextResponse } from "next/server";

import { filterHiddenVideos } from "@/lib/catalog-data";
import { getOptionalApiAuth } from "@/lib/auth-request";
import { clamp } from "@/lib/number-utils";
import { getTopVideosFast, warmTopVideos } from "@/lib/top-videos-cache";

const TOP_VIDEOS_WAIT_MS = 2_000;

export async function GET(request: NextRequest) {
  const countParam = request.nextUrl.searchParams.get("count") ?? "100";
  const skipParam = request.nextUrl.searchParams.get("skip");
  const takeParam = request.nextUrl.searchParams.get("take");
  const paginationRequested = skipParam !== null || takeParam !== null;
  const skip = Math.max(0, Number.parseInt(skipParam ?? "0", 10) || 0);
  const take = clamp(Number.parseInt(takeParam ?? "24", 10) || 24, 1, 200);
  const count = clamp(Number.parseInt(countParam, 10) || 100, 1, 1000);
  const sourceCount = paginationRequested
    ? clamp(skip + take, 100, 1000)
    : Math.max(count, 100);

  warmTopVideos(sourceCount);
  let videos = await getTopVideosFast(sourceCount, TOP_VIDEOS_WAIT_MS);

  // Filter blocked videos if user is authenticated
  const authResult = await getOptionalApiAuth(request);
  if (authResult?.userId) {
    videos = await filterHiddenVideos(videos, authResult.userId);
  }

  if (paginationRequested) {
    return NextResponse.json({
      videos: videos.slice(skip, skip + take),
      skip,
      take,
    });
  }

  return NextResponse.json({ videos: videos.slice(0, count) });
}
