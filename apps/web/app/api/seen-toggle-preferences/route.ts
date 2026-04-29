import { NextRequest, NextResponse } from "next/server";

import {
  seenTogglePreferenceKeySchema,
  seenTogglePreferenceMutationSchema,
} from "@/lib/api-schemas";
import { requireApiAuth } from "@/lib/auth-request";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";
import {
  getSeenTogglePreferenceForUser,
  setSeenTogglePreferenceForUser,
} from "@/lib/seen-toggle-preference-data";

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const parsedKey = seenTogglePreferenceKeySchema.safeParse(request.nextUrl.searchParams.get("key") ?? "");
  if (!parsedKey.success) {
    return NextResponse.json({ error: parsedKey.error.flatten() }, { status: 400 });
  }

  const value = await getSeenTogglePreferenceForUser({
    userId: authResult.auth.userId,
    key: parsedKey.data,
  });

  return NextResponse.json({
    key: parsedKey.data,
    value,
  });
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

  const parsed = seenTogglePreferenceMutationSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await setSeenTogglePreferenceForUser({
    userId: authResult.auth.userId,
    key: parsed.data.key,
    value: parsed.data.value,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "Preference persistence unavailable" }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
