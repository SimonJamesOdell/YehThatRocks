import { NextRequest, NextResponse } from "next/server";

import { getRequestMetadata, recordAuthAudit } from "@/lib/auth-audit";
import { clearAuthCookies, readAuthCookies, setAccessAuthCookie, setAuthCookies } from "@/lib/auth-cookies";
import { signAccessToken, signRefreshToken, verifyToken } from "@/lib/auth-jwt";
import { rotateRefreshSession } from "@/lib/auth-sessions";

function isSafeRedirectTarget(next: string | null): next is string {
  if (!next) return false;
  // Only allow relative paths on this origin — no protocol, no host.
  return next.startsWith("/") && !next.startsWith("//");
}

/**
 * See /api/auth/refresh for the rationale: only a genuinely dead session (or an
 * invalid token) clears the auth cookies. Transient DB/rotation failures must
 * redirect without clearing, or a healthy session is logged out by a hiccup.
 */
function isDeadSessionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === "Session not found"
    || error.message === "Session expired"
    || error.message === "Session revoked"
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

  let payload: Awaited<ReturnType<typeof verifyToken>>;
  try {
    payload = await verifyToken(refreshToken, "refresh");
  } catch {
    await recordAuthAudit({
      action: "refresh",
      success: false,
      detail: "Silent refresh failed (invalid token)",
      ...requestMeta,
    });

    const response = NextResponse.redirect(new URL(destination, request.url));
    clearAuthCookies(response);
    return response;
  }

  try {
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

      const racedAccessToken = await signAccessToken(payload.uid, payload.email);
      setAccessAuthCookie(response, racedAccessToken);

      await recordAuthAudit({
        action: "refresh",
        success: true,
        detail: "Silent refresh — already rotated by parallel request",
        ...requestMeta,
      });

      return response;
    }

    if (isDeadSessionError(error)) {
      await recordAuthAudit({
        action: "refresh",
        success: false,
        email: payload.email,
        userId: payload.uid,
        detail: "Silent refresh failed (session not found/expired/revoked)",
        ...requestMeta,
      });

      const response = NextResponse.redirect(new URL(destination, request.url));
      clearAuthCookies(response);
      return response;
    }

    // Transient failure — keep cookies and redirect without clearing so the
    // session survives a DB hiccup.
    await recordAuthAudit({
      action: "refresh",
      success: false,
      email: payload.email,
      userId: payload.uid,
      detail: "Silent refresh failed (transient)",
      ...requestMeta,
    });

    return NextResponse.redirect(new URL(destination, request.url));
  }
}
