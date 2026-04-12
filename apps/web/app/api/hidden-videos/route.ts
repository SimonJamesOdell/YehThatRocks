import { NextRequest, NextResponse } from "next/server";

import { hiddenVideoMutationSchema } from "@/lib/api-schemas";
import { requireApiAuth } from "@/lib/auth-request";
import { getHiddenVideoIdsForUser, hideVideoForUser, unhideVideoForUser } from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const hiddenVideoIds = await getHiddenVideoIdsForUser(authResult.auth.userId);
  return NextResponse.json({ hiddenVideoIds: Array.from(hiddenVideoIds) });
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

  const parsed = hiddenVideoMutationSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await hideVideoForUser({
    userId: authResult.auth.userId,
    videoId: parsed.data.videoId,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "Failed to hide video" }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
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

  const parsed = hiddenVideoMutationSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await unhideVideoForUser({
    userId: authResult.auth.userId,
    videoId: parsed.data.videoId,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "Failed to unhide video" }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
