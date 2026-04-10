import { NextRequest, NextResponse } from "next/server";

import { searchCatalog } from "@/lib/catalog-data";
import { rateLimitOrResponse } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const limited = rateLimitOrResponse(request, "search:query", 20, 10_000);
  if (limited) return limited;

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const results = await searchCatalog(query);

  return NextResponse.json({
    query,
    ...results
  });
}
