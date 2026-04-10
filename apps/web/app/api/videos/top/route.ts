import { NextRequest, NextResponse } from "next/server";

import { getTopVideosFast, warmTopVideos } from "@/lib/top-videos-cache";

const TOP_VIDEOS_WAIT_MS = 800;

export async function GET(request: NextRequest) {
  const countParam = request.nextUrl.searchParams.get("count") ?? "100";
  const count = Math.max(1, Math.min(1000, parseInt(countParam, 10) || 100));
  warmTopVideos(Math.max(count, 100));
  const videos = await getTopVideosFast(count, TOP_VIDEOS_WAIT_MS);
  return NextResponse.json({ videos });
}
