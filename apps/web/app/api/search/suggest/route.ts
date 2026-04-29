import { NextRequest, NextResponse } from "next/server";

import { suggestCatalog } from "@/lib/catalog-data";
import { rateLimitOrResponse } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const limited = rateLimitOrResponse(request, "search:suggest", 30, 10_000);
  if (limited) return limited;

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const suggestions = await suggestCatalog(query);

  return NextResponse.json({ suggestions });
}
