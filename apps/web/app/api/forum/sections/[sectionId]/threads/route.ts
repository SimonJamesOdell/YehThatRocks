/**
 * GET /api/forum/sections/[sectionId]/threads — threads for a specific section
 */

import { NextRequest, NextResponse } from "next/server";

import { getSectionThreads } from "@/lib/forum-data";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> },
) {
  const { sectionId } = await params;
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") || "30");
  const limit = Math.max(1, Math.min(50, Number.isFinite(rawLimit) ? rawLimit : 30));

  try {
    const threads = await getSectionThreads(sectionId, limit);
    return NextResponse.json({ threads });
  } catch {
    return NextResponse.json({ threads: [] });
  }
}
