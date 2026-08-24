/**
 * GET  /api/forum/threads/[threadId]/vote — get vote counts + current user's vote
 * POST /api/forum/threads/[threadId]/vote — cast or change a vote
 */

import { NextRequest, NextResponse } from "next/server";

import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";
import { parseRequestJson } from "@/lib/request-json";
import { getVoteCounts, getUserVote, castVote } from "@/lib/forum-data";
import { verifySameOrigin } from "@/lib/csrf";
import { rateLimitOrResponse, rateLimitSharedOrResponse } from "@/lib/rate-limit";
import { HTTP_UNAUTHORIZED } from "@/lib/http-status";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId: threadIdRaw } = await params;
  const threadId = Number(threadIdRaw);

  if (!Number.isInteger(threadId) || threadId <= 0) {
    return NextResponse.json({ error: "Invalid thread ID" }, { status: 400 });
  }

  const authState = await getCurrentAuthenticatedUserAuthState();
  const userId = authState.status === "authenticated" ? authState.user.id : null;

  try {
    const [counts, userVote] = await Promise.all([
      getVoteCounts(threadId),
      userId ? getUserVote(threadId, userId) : Promise.resolve(null),
    ]);

    return NextResponse.json({ voteCounts: counts, userVote });
  } catch {
    return NextResponse.json({ voteCounts: null, userVote: null });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const authState = await getCurrentAuthenticatedUserAuthState();
  if (authState.status !== "authenticated") {
    return NextResponse.json({ error: "Authentication required" }, { status: HTTP_UNAUTHORIZED });
  }

  const csrfError = verifySameOrigin(request);
  if (csrfError) {
    return csrfError;
  }

  const ipRateLimited = rateLimitOrResponse(request, `forum:vote:${authState.user.id}`, 60, 60 * 1000);
  if (ipRateLimited) {
    return ipRateLimited;
  }

  const userRateLimited = rateLimitSharedOrResponse(`forum:vote:user:${authState.user.id}`, 120, 60 * 1000);
  if (userRateLimited) {
    return userRateLimited;
  }

  const { threadId: threadIdRaw } = await params;
  const threadId = Number(threadIdRaw);

  if (!Number.isInteger(threadId) || threadId <= 0) {
    return NextResponse.json({ error: "Invalid thread ID" }, { status: 400 });
  }

  const parsedJson = await parseRequestJson<{ vote?: number }>(request);
  if (!parsedJson.ok) {
    return parsedJson.response;
  }
  const { vote } = parsedJson.data;

  if (vote !== 1 && vote !== 2) {
    return NextResponse.json({ error: "Vote must be 1 or 2" }, { status: 400 });
  }

  const voteCounts = await castVote(threadId, authState.user.id, vote);

  if (!voteCounts) {
    return NextResponse.json({ error: "Failed to cast vote" }, { status: 500 });
  }

  return NextResponse.json({ voteCounts, userVote: vote });
}
