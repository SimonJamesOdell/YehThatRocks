import { NextRequest, NextResponse } from "next/server";

import { filterHiddenVideos } from "@/lib/catalog-data";
import { getOptionalApiAuth } from "@/lib/auth-request";
import { getTopVideosFast, warmTopVideos } from "@/lib/top-videos-cache";

const TOP_VIDEOS_WAIT_MS = 800;

export async function GET(request: NextRequest) {
  const countParam = request.nextUrl.searchParams.get("count") ?? "100";
  const skipParam = request.nextUrl.searchParams.get("skip");
  const takeParam = request.nextUrl.searchParams.get("take");
  const paginationRequested = skipParam !== null || takeParam !== null;
  const skip = Math.max(0, parseInt(skipParam ?? "0", 10) || 0);
  const take = Math.max(1, Math.min(200, parseInt(takeParam ?? "24", 10) || 24));
  const count = Math.max(1, Math.min(1000, parseInt(countParam, 10) || 100));
  const sourceCount = paginationRequested
    ? Math.max(100, Math.min(1000, skip + take))
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
