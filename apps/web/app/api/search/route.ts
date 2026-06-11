import { NextRequest, NextResponse } from "next/server";

import { filterHiddenVideos, searchCatalog } from "@/lib/catalog-data";
import { getOptionalApiAuth } from "@/lib/auth-request";
import { rateLimitOrResponse } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const limited = rateLimitOrResponse(request, "search:query", 20, 10_000);
  if (limited) return limited;

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const limit = Math.max(1, Math.min(200, Number(request.nextUrl.searchParams.get("limit")) || 50));
  const offset = Math.max(0, Number(request.nextUrl.searchParams.get("offset")) || 0);

  const results = await searchCatalog(query, { limit, offset });

  // Filter blocked videos if user is authenticated
  const authResult = await getOptionalApiAuth(request);
  if (authResult?.userId && results.videos) {
    results.videos = await filterHiddenVideos(results.videos, authResult.userId);
  }

  return NextResponse.json({
    query,
    limit,
    offset,
    ...results
  });
}