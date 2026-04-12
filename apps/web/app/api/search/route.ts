import { NextRequest, NextResponse } from "next/server";

import { filterHiddenVideos, searchCatalog } from "@/lib/catalog-data";
import { getOptionalApiAuth } from "@/lib/auth-request";
import { rateLimitOrResponse } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const limited = rateLimitOrResponse(request, "search:query", 20, 10_000);
  if (limited) return limited;

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const results = await searchCatalog(query);

  // Filter blocked videos if user is authenticated
  const authResult = await getOptionalApiAuth(request);
  if (authResult?.userId && results.videos) {
    results.videos = await filterHiddenVideos(results.videos, authResult.userId);
  }

  return NextResponse.json({
    query,
    ...results
  });
}
