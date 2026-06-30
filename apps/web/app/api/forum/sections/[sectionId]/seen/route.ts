/**
 * POST /api/forum/sections/[sectionId]/seen — mark a section as seen
 */

import { NextRequest, NextResponse } from "next/server";

import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";
import { markSectionSeen } from "@/lib/forum-data";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> },
) {
  const authState = await getCurrentAuthenticatedUserAuthState();
  if (authState.status !== "authenticated") {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { sectionId } = await params;

  await markSectionSeen(authState.user.id, sectionId);

  return NextResponse.json({ ok: true });
}
