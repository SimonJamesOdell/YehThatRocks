import { NextRequest, NextResponse } from "next/server";

import { getRequestMetadata, recordAuthAudit } from "@/lib/auth-audit";
import { clearAuthCookies, readAuthCookies, setAccessAuthCookie, setAuthCookies } from "@/lib/auth-cookies";
import { isTokenValidationError, signAccessToken, signRefreshToken, verifyToken } from "@/lib/auth-jwt";
import { rotateRefreshSession } from "@/lib/auth-sessions";

function isSafeRedirectTarget(next: string | null): next is string {
  if (!next) return false;
  // Only allow relative paths on this origin — no protocol, no host.
  return next.startsWith("/") && !next.startsWith("//");
}

function shouldClearCookiesOnFailure(error: unknown) {
  if (isTokenValidationError(error)) return true;
  if (!(error instanceof Error)) return false;
  const { message } = error;
  return (
    message === "invalid signature"
    || message === "token expired"
    || message === "Session not found"
    || message === "Session expired"
    || message === "Refresh token reuse detected"
    || message === "Session revoked"
  );
}

export async function GET(request: NextRequest) {
  const requestMeta = getRequestMetadata(request.headers);
  const next = request.nextUrl.searchParams.get("next");
  const destination = isSafeRedirectTarget(next) ? next : "/";

  const { refreshToken } = readAuthCookies(request);

  if (!refreshToken) {
    return NextResponse.redirect(new URL(destination, request.url));
  }

  let payload: Awaited<ReturnType<typeof verifyToken>> | null = null;

  try {
    payload = await verifyToken(refreshToken, "refresh");
    const accessToken = await signAccessToken(payload.uid, payload.email);
    const rotatedRefreshToken = await signRefreshToken(payload.uid, payload.email, payload.remember);
    await rotateRefreshSession(payload.uid, refreshToken, rotatedRefreshToken, payload.remember);

    const response = NextResponse.redirect(new URL(destination, request.url));
    setAuthCookies(response, accessToken, rotatedRefreshToken, payload.remember);

    await recordAuthAudit({
      action: "refresh",
      success: true,
      email: payload.email,
      userId: payload.uid,
      detail: "Silent refresh successful",
      ...requestMeta,
    });

    return response;
  } catch (error) {
    if (error instanceof Error && error.message === "Session already rotated") {
      const response = NextResponse.redirect(new URL(destination, request.url));

      if (payload) {
        const racedAccessToken = await signAccessToken(payload.uid, payload.email);
        setAccessAuthCookie(response, racedAccessToken);
      }

      await recordAuthAudit({
        action: "refresh",
        success: true,
        detail: "Silent refresh — already rotated by parallel request",
        ...requestMeta,
      });

      return response;
    }

    const shouldClear = shouldClearCookiesOnFailure(error);

    await recordAuthAudit({
      action: "refresh",
      success: false,
      detail: shouldClear ? "Silent refresh failed (invalid token/session)" : "Silent refresh failed (transient)",
      ...requestMeta,
    });

    const response = NextResponse.redirect(new URL(destination, request.url));

    if (shouldClear) {
      clearAuthCookies(response);
    }

    return response;
  }
}
