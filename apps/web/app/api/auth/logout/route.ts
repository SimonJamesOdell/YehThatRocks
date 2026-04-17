import { NextRequest, NextResponse } from "next/server";

import { getRequestMetadata, recordAuthAudit } from "@/lib/auth-audit";
import { clearAuthCookies, readAuthCookies } from "@/lib/auth-cookies";
import { verifySameOrigin } from "@/lib/csrf";
import { revokeRefreshSessionFamily } from "@/lib/auth-sessions";

export async function POST(request: NextRequest) {
  const requestMeta = getRequestMetadata(request.headers);
  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const { refreshToken } = readAuthCookies(request);

  if (refreshToken) {
    await revokeRefreshSessionFamily(refreshToken);
  }

  await recordAuthAudit({
    action: "logout",
    success: true,
    detail: "Logout successful",
    ...requestMeta,
  });

  const response = NextResponse.json({ ok: true });
  clearAuthCookies(response);
  return response;
}
