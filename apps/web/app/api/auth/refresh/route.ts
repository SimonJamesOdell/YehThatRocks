import { NextRequest, NextResponse } from "next/server";

import { getRequestMetadata, recordAuthAudit } from "@/lib/auth-audit";
import { clearAuthCookies, readAuthCookies, setAccessAuthCookie, setAuthCookies } from "@/lib/auth-cookies";
import { verifySameOrigin } from "@/lib/csrf";
import { isTokenValidationError, signAccessToken, signRefreshToken, verifyToken } from "@/lib/auth-jwt";
import { rotateRefreshSession } from "@/lib/auth-sessions";

function shouldClearCookiesOnRefreshFailure(error: unknown) {
  if (isTokenValidationError(error)) {
    return true;
  }

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
    || message === "Session revoked"
  );
}

export async function POST(request: NextRequest) {
  const requestMeta = getRequestMetadata(request.headers);
  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const { refreshToken } = readAuthCookies(request);
  let payload: Awaited<ReturnType<typeof verifyToken>> | null = null;

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
    payload = await verifyToken(refreshToken, "refresh");
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
    if (error instanceof Error && error.message === "Session already rotated") {
      const response = NextResponse.json({ ok: true, raced: true });

      if (payload) {
        // Preserve auth for the in-flight request while another tab/request finishes rotation.
        const racedAccessToken = await signAccessToken(payload.uid, payload.email);
        setAccessAuthCookie(response, racedAccessToken);
      }

      await recordAuthAudit({
        action: "refresh",
        success: true,
        detail: "Refresh already rotated by a parallel request",
        ...requestMeta,
      });
      return response;
    }

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
