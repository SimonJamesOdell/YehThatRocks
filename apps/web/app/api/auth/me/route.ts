import { NextRequest, NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth-request";

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok || authResult.auth.userId === null) {
    return authResult.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
