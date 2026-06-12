/**
 * GET /api/forum/threads/[threadId] — single thread with posts
 */

import { NextRequest, NextResponse } from "next/server";

import { getThreadDetail, incrementThreadViewCount } from "@/lib/forum-data";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId: threadIdRaw } = await params;
  const threadId = Number(threadIdRaw);

  if (!Number.isInteger(threadId) || threadId <= 0) {
    return NextResponse.json({ error: "Invalid thread ID" }, { status: 400 });
  }

  try {
    const detail = await getThreadDetail(threadId);
    if (!detail) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    // Fire-and-forget view count increment
    incrementThreadViewCount(threadId).catch(() => {});

    return NextResponse.json(detail);
  } catch {
    return NextResponse.json({ error: "Failed to fetch thread" }, { status: 500 });
  }
}
