import { NextRequest, NextResponse } from "next/server";

import { playerPreferenceMutationSchema } from "@/lib/api-schemas";
import { requireApiAuth } from "@/lib/auth-request";
import { verifySameOrigin } from "@/lib/csrf";
import {
  getPlayerPreferencesForUser,
  setPlayerPreferencesForUser,
} from "@/lib/player-preference-data";
import { parseRequestJson } from "@/lib/request-json";

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const value = await getPlayerPreferencesForUser({
    userId: authResult.auth.userId,
  });

  return NextResponse.json(value);
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const csrfError = verifySameOrigin(request);
  if (csrfError) {
    return csrfError;
  }

  const bodyResult = await parseRequestJson(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = playerPreferenceMutationSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await setPlayerPreferencesForUser({
    userId: authResult.auth.userId,
    autoplayEnabled: parsed.data.autoplayEnabled,
    volume: parsed.data.volume,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "Preference persistence unavailable" }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
