import { NextRequest, NextResponse } from "next/server";

import { isAdminIdentity } from "@/lib/admin-auth";
import { searchFlagSchema } from "@/lib/api-schemas";
import { withAuthAndBody } from "@/lib/api-route-pipeline";
import {
  getSearchFlagConsensus,
  recordSearchFlag,
} from "@/lib/search-flag-data";
import {
  SEARCH_FLAG_MIN_USERS_FOR_ACTION,
  SEARCH_FLAG_REASON_LABELS,
} from "@/lib/search-flags";

export async function POST(request: NextRequest) {
  const result = await withAuthAndBody(request, searchFlagSchema, { authMode: "user" });
  if (!result.ok) {
    return result.response;
  }

  const adminFlagger = isAdminIdentity(result.auth.userId, result.auth.email);
  const { videoId, query, reason, correction } = result.data;

  try {
    const saved = await recordSearchFlag({
      userId: result.auth.userId,
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
