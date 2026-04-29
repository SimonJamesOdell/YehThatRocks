import { NextRequest, NextResponse } from "next/server";

import { getRequestMetadata, recordAuthAudit } from "@/lib/auth-audit";
import { clearAuthCookies, readAuthCookies } from "@/lib/auth-cookies";
import { verifyToken } from "@/lib/auth-jwt";
import { verifySameOrigin } from "@/lib/csrf";
import { revokeRefreshSessionFamily, revokeUserRefreshSessions } from "@/lib/auth-sessions";

export async function POST(request: NextRequest) {
  const requestMeta = getRequestMetadata(request.headers);
  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const { accessToken, refreshToken } = readAuthCookies(request);

  if (refreshToken) {
    await revokeRefreshSessionFamily(refreshToken);

    try {
      const refreshPayload = await verifyToken(refreshToken, "refresh");
      await revokeUserRefreshSessions(refreshPayload.uid);
    } catch {
      // Best-effort only. Family revocation already handled above.
    }
  }

  if (accessToken) {
    try {
      const accessPayload = await verifyToken(accessToken, "access");
      await revokeUserRefreshSessions(accessPayload.uid);
    } catch {
      // Access token may already be expired; keep logout resilient.
    }
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
