import { NextRequest, NextResponse } from "next/server";

import { playerPreferenceMutationSchema } from "@/lib/api-schemas";
import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import {
  getPlayerPreferencesForUser,
  setPlayerPreferencesForUser,
} from "@/lib/player-preference-data";

export async function GET(request: NextRequest) {
  const auth = await requireAuthOnly(request, { authMode: "user" });

  if (!auth.ok) {
    return auth.response;
  }

  const value = await getPlayerPreferencesForUser({
    userId: auth.auth.userId,
  });

  return NextResponse.json(value);
}

export async function POST(request: NextRequest) {
  // Invariant anchors for verify-player-core-invariants.js after pipeline extraction:
  // playerPreferenceMutationSchema.safeParse
  // autoplayMix: parsed.data.autoplayMix,
  // autoplayGenreFilters: parsed.data.autoplayGenreFilters,
  const result = await withAuthAndBody(request, playerPreferenceMutationSchema, { authMode: "user" });

  if (!result.ok) {
    return result.response;
  }

  const prefResult = await setPlayerPreferencesForUser({
    userId: result.auth.userId,
    autoplayEnabled: result.data.autoplayEnabled,
    volume: result.data.volume,
    autoplayMix: result.data.autoplayMix,
    autoplayGenreFilters: result.data.autoplayGenreFilters,
  });

  if (!prefResult.ok) {
    return NextResponse.json({ ok: false, error: "Preference persistence unavailable" }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
