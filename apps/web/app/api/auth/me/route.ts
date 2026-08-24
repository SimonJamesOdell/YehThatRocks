import { NextRequest, NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth-request";
import { HTTP_UNAUTHORIZED } from "@/lib/http-status";

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }
  if (authResult.auth.userId === null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: HTTP_UNAUTHORIZED });
  }

  return NextResponse.json({
    user: {
      id: authResult.auth.userId,
      email: authResult.auth.email,
      emailVerifiedAt: null,
      screenName: null,
      avatarUrl: null,
    },
  });
}
