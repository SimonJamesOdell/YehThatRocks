/**
 * GET  /api/forum/threads — latest threads across all sections
 * POST /api/forum/threads — create a new thread
 */

import { NextRequest, NextResponse } from "next/server";

import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";
import { parseRequestJson } from "@/lib/request-json";
import { getLatestThreads, createThread } from "@/lib/forum-data";

export async function GET(request: NextRequest) {
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") || "20");
  const limit = Math.max(1, Math.min(50, Number.isFinite(rawLimit) ? rawLimit : 20));

  try {
    const threads = await getLatestThreads(limit);
    return NextResponse.json({ threads });
  } catch {
    return NextResponse.json({ threads: [] });
  }
}

export async function POST(request: NextRequest) {
  const authState = await getCurrentAuthenticatedUserAuthState();
  if (authState.status !== "authenticated") {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const parsedJson = await parseRequestJson<{ sectionId?: string; title?: string; content?: string; video1Id?: string; video2Id?: string }>(request);
  if (!parsedJson.ok) {
    return parsedJson.response;
  }
  const { sectionId, title, content, video1Id, video2Id } = parsedJson.data;

  if (!sectionId || !title || !content) {
    return NextResponse.json(
      { error: "sectionId, title, and content are required" },
      { status: 400 },
    );
  }

  if (typeof title !== "string" || title.trim().length < 3) {
    return NextResponse.json(
      { error: "Title must be at least 3 characters" },
      { status: 400 },
    );
  }

  if (typeof content !== "string" || content.trim().length < 10) {
    return NextResponse.json(
      { error: "Content must be at least 10 characters" },
      { status: 400 },
    );
  }

  const thread = await createThread(sectionId, title, authState.user.id, content, video1Id, video2Id);

  if (!thread) {
    return NextResponse.json({ error: "Failed to create thread" }, { status: 500 });
  }

  return NextResponse.json({ thread }, { status: 201 });
}