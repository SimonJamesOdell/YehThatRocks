import { NextRequest, NextResponse } from "next/server";

import {
  buildSitemapUrlSet,
  getSitemapEntriesForShard,
  parseSitemapShardId,
} from "@/lib/sitemap-data";

export const revalidate = 86400;

type SitemapRouteContext = {
  params?: Promise<{ id?: string[] }> | { id?: string[] };
};

export async function GET(_request: NextRequest, context: SitemapRouteContext = {}) {
  const params = context.params ? await context.params : undefined;
  const rawShard = Array.isArray(params?.id) ? params.id[0] : undefined;
  const shardId = parseSitemapShardId(rawShard);

  if (shardId === null) {
    return new NextResponse("Not found", { status: 404 });
  }

  const entries = await getSitemapEntriesForShard(shardId);

  return new NextResponse(buildSitemapUrlSet(entries), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
    },
  });
}