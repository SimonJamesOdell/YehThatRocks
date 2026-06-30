/**
 * GET /api/forum/sections — all forum sections with thread counts and unseen counts
 */

import { NextRequest, NextResponse } from "next/server";

import { FORUM_SECTIONS } from "@/lib/forum-sections";
import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";
import { getSectionThreadCounts, getSectionUnseenCounts } from "@/lib/forum-data";

export type ForumSectionSummary = {
  id: string;
  title: string;
  description: string;
  threadCount: number;
  newThreads: number;
  updatedThreads: number;
};

export async function GET(_request: NextRequest) {
  try {
    const authState = await getCurrentAuthenticatedUserAuthState();
    const isAuthenticated = authState.status === "authenticated";

    const threadCounts = await getSectionThreadCounts();

    let unseenMap: Map<string, { newThreads: number; updatedThreads: number }> | null = null;
    if (isAuthenticated) {
      unseenMap = await getSectionUnseenCounts(authState.user.id);
    }

    const sections: ForumSectionSummary[] = FORUM_SECTIONS.map((s) => {
      const unseen = unseenMap?.get(s.id);
      return {
        id: s.id,
        title: s.title,
        description: s.description,
        threadCount: threadCounts.get(s.id) ?? 0,
        newThreads: unseen?.newThreads ?? 0,
        updatedThreads: unseen?.updatedThreads ?? 0,
      };
    });

    // Cache for 30 seconds — section counts change infrequently
    const headers = new Headers();
    headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");

    return NextResponse.json({ sections }, { headers });
  } catch {
    return NextResponse.json({ sections: [] });
  }
}
