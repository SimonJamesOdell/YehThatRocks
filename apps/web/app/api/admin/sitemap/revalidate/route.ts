import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { withAuthAndCsrf } from "@/lib/api-route-pipeline";
import { getSitemapShardIds } from "@/lib/sitemap-data";

export async function POST(request: NextRequest) {
  const result = await withAuthAndCsrf(request);
  if (!result.ok) {
    return result.response;
  }

  const sitemapPaths = [
    "/sitemap.xml",
    ...(await getSitemapShardIds()).map((id) => `/sitemap/${id}.xml`),
    "/robots.txt",
  ];

  for (const path of sitemapPaths) {
    revalidatePath(path);
  }

  return NextResponse.json({
    ok: true,
    revalidated: sitemapPaths,
    at: new Date().toISOString(),
  });
}