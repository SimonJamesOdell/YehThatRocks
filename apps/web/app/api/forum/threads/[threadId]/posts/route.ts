/**
 * POST /api/forum/threads/[threadId]/posts — reply to a thread
 */

import { NextRequest, NextResponse } from "next/server";

import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";
import { parseRequestJson } from "@/lib/request-json";
import { createPost } from "@/lib/forum-data";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const authState = await getCurrentAuthenticatedUserAuthState();
  if (authState.status !== "authenticated") {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { threadId: threadIdRaw } = await params;
  const threadId = Number(threadIdRaw);

  if (!Number.isInteger(threadId) || threadId <= 0) {
    return NextResponse.json({ error: "Invalid thread ID" }, { status: 400 });
  }

  const parsedJson = await parseRequestJson<{ content?: string }>(request);
  if (!parsedJson.ok) {
    return parsedJson.response;
  }
  const { content } = parsedJson.data;

  if (!content || typeof content !== "string" || content.trim().length < 2) {
    return NextResponse.json(
      { error: "Content must be at least 2 characters" },
      { status: 400 },
    );
  }

  const post = await createPost(threadId, authState.user.id, content);

  if (!post) {
    return NextResponse.json({ error: "Failed to create reply" }, { status: 500 });
  }

  return NextResponse.json({ post }, { status: 201 });
}