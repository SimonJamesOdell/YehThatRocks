import { NextRequest, NextResponse } from "next/server";

import { isAdminIdentity } from "@/lib/admin-auth";
import { searchFlagSchema } from "@/lib/api-schemas";
import { requireApiAuth } from "@/lib/auth-request";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";
import {
  getSearchFlagConsensus,
  recordSearchFlag,
} from "@/lib/search-flag-data";
import {
  SEARCH_FLAG_MIN_USERS_FOR_ACTION,
  SEARCH_FLAG_REASON_LABELS,
} from "@/lib/search-flags";

const HTTP_FORBIDDEN = 403;

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) {
    return authResult.response;
  }

  const csrfError = verifySameOrigin(request);
  if (csrfError) {
    return csrfError;
  }

  const bodyResult = await parseRequestJson<unknown>(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = searchFlagSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const userId = authResult.auth.userId;

  if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Authentication context is invalid." }, { status: HTTP_FORBIDDEN });
  }

  const userEmail = authResult.auth.email ?? "";
  const adminFlagger = isAdminIdentity(userId, userEmail);
  const { videoId, query, reason, correction } = parsed.data;

  try {
    const saved = await recordSearchFlag({
      userId,
      videoId,
      query,
      reason,
      correction,
      adminFlagger,
    });

    if (!saved.ok) {
      return NextResponse.json({ ok: false, error: "Failed to record search flag" }, { status: 503 });
    }

    const consensus = await getSearchFlagConsensus({
      videoId,
      query,
      reason,
      correction,
    });

    return NextResponse.json({
      ok: true,
      reason,
      reasonLabel: SEARCH_FLAG_REASON_LABELS[reason],
      adminFlagger,
      appliedImmediately: adminFlagger || consensus.applied,
      matchingUsers: consensus.matchingUsers,
      minimumUsersThreshold: SEARCH_FLAG_MIN_USERS_FOR_ACTION,
      normalizedQuery: saved.normalizedQuery,
      normalizedCorrection: saved.normalizedCorrection,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to record search flag" }, { status: 503 });
  }
}
