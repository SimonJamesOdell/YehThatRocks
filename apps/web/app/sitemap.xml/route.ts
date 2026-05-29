import { NextResponse } from "next/server";

import { buildSitemapIndex, getSitemapShardIds } from "@/lib/sitemap-data";

export const revalidate = 86400;

export async function GET() {
  const shardIds = await getSitemapShardIds();

  return new NextResponse(buildSitemapIndex(shardIds), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
    },
  });
}