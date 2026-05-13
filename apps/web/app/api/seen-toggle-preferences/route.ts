import { NextRequest, NextResponse } from "next/server";

import {
  seenTogglePreferenceKeySchema,
  seenTogglePreferenceMutationSchema,
} from "@/lib/api-schemas";
import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import {
  getSeenTogglePreferenceForUser,
  setSeenTogglePreferenceForUser,
} from "@/lib/seen-toggle-preference-data";

export async function GET(request: NextRequest) {
  const auth = await requireAuthOnly(request, { authMode: "user" });

  if (!auth.ok) {
    return auth.response;
  }

  const parsedKey = seenTogglePreferenceKeySchema.safeParse(request.nextUrl.searchParams.get("key") ?? "");
  if (!parsedKey.success) {
    return NextResponse.json({ error: parsedKey.error.flatten() }, { status: 400 });
  }

  const value = await getSeenTogglePreferenceForUser({
    userId: auth.auth.userId,
    key: parsedKey.data,
  });

  return NextResponse.json({
    key: parsedKey.data,
    value,
  });
}

export async function POST(request: NextRequest) {
  const result = await withAuthAndBody(request, seenTogglePreferenceMutationSchema, { authMode: "user" });

  if (!result.ok) {
    return result.response;
  }

  const prefResult = await setSeenTogglePreferenceForUser({
    userId: result.auth.userId,
    key: result.data.key,
    value: result.data.value,
  });

  if (!prefResult.ok) {
    return NextResponse.json({ ok: false, error: "Preference persistence unavailable" }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
