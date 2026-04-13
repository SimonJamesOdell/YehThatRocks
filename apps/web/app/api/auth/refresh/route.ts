import { NextRequest, NextResponse } from "next/server";

import { getRequestMetadata, recordAuthAudit } from "@/lib/auth-audit";
import { clearAuthCookies, readAuthCookies, setAuthCookies } from "@/lib/auth-cookies";
import { verifySameOrigin } from "@/lib/csrf";
import { signAccessToken, signRefreshToken, verifyToken } from "@/lib/auth-jwt";
import { rotateRefreshSession } from "@/lib/auth-sessions";

function shouldClearCookiesOnRefreshFailure(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message;
  return (
    message === "invalid signature"
    || message === "token expired"
    || message === "Session not found"
    || message === "Session expired"
    || message === "Refresh token reuse detected"
  );
}

export async function POST(request: NextRequest) {
  const requestMeta = getRequestMetadata(request.headers);
  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const { refreshToken } = readAuthCookies(request);

  if (!refreshToken) {
    await recordAuthAudit({
      action: "refresh",
      success: false,
      detail: "Missing refresh token",
      ...requestMeta,
    });
    return NextResponse.json({ error: "Missing refresh token" }, { status: 401 });
  }

  try {
    const payload = await verifyToken(refreshToken, "refresh");
    const accessToken = await signAccessToken(payload.uid, payload.email);
    const rotatedRefreshToken = await signRefreshToken(payload.uid, payload.email, payload.remember);
    await rotateRefreshSession(payload.uid, refreshToken, rotatedRefreshToken, payload.remember);
    const response = NextResponse.json({ ok: true });

    setAuthCookies(response, accessToken, rotatedRefreshToken, payload.remember);
    await recordAuthAudit({
      action: "refresh",
      success: true,
      email: payload.email,
      userId: payload.uid,
      detail: "Refresh successful",
      ...requestMeta,
    });
    return response;
  } catch (error) {
    const shouldClearCookies = shouldClearCookiesOnRefreshFailure(error);

    await recordAuthAudit({
      action: "refresh",
      success: false,
      detail: shouldClearCookies ? "Refresh failed (invalid token/session)" : "Refresh failed (transient)",
      ...requestMeta,
    });

    const response = shouldClearCookies
      ? NextResponse.json({ error: "Invalid refresh token" }, { status: 401 })
      : NextResponse.json({ error: "Refresh temporarily unavailable" }, { status: 503 });

    if (shouldClearCookies) {
      clearAuthCookies(response);
    }

    return response;
  }
}
