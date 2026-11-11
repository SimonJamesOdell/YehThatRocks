import { NextRequest, NextResponse } from "next/server";

import { getRequestMetadata, recordAuthAudit } from "@/lib/auth-audit";
import { clearAuthCookies, readAuthCookies, setAccessAuthCookie, setAuthCookies } from "@/lib/auth-cookies";
import { verifySameOrigin } from "@/lib/csrf";
import { signAccessToken, signRefreshToken, verifyToken } from "@/lib/auth-jwt";
import { rotateRefreshSession } from "@/lib/auth-sessions";
import { rateLimitOrResponse } from "@/lib/rate-limit";

const HTTP_UNAUTHORIZED = 401;

// Per-IP refresh rate limit. Legitimate usage is ~1 refresh per access-token
// expiry (15 min) per active tab, so this ceiling is far above real traffic
// while capping a single-IP flood against the token-rotation endpoint.
const REFRESH_RATE_LIMIT = 30;
const REFRESH_RATE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Only these session-rotation failures mean "the session is dead": clear the
 * cookies and return 401 so the client performs a definitive sign-out. Every
 * other rotation failure (DB unreachable, transaction timeout, serialisation
 * error, …) is transient — the refresh token may still be valid, and clearing
 * cookies there would log a healthy session out because of a hiccup. During
 * bot-fight mode the origin is under load, which is exactly when transient DB
 * failures happen, so this distinction is load-bearing.
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

export async function POST(request: NextRequest) {
  // First-line defense: cap per-IP refresh attempts before any crypto or DB
  // work. A distributed botnet firing tokenless refresh requests was previously
  // able to drive ~15k failed auth-audit writes per day through this endpoint.
  const rateLimitResponse = rateLimitOrResponse(
    request,
    "auth:refresh",
    REFRESH_RATE_LIMIT,
    REFRESH_RATE_WINDOW_MS,
  );
  if (rateLimitResponse) {
    console.warn("[auth] refresh rate limited — per-IP cap exceeded");
    return rateLimitResponse;
  }

  const requestMeta = getRequestMetadata(request.headers);
  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const { refreshToken } = readAuthCookies(request);

  if (!refreshToken) {
    // Do NOT write an auth-audit row here. A request with no token carries no
    // identity to audit, and the distributed "missing token" botnet turns this
    // single write into thousands of junk rows per day. Returning 401 is the
    // complete, correct response.
    return NextResponse.json({ error: "Missing refresh token" }, { status: HTTP_UNAUTHORIZED });
  }

  // Verify the token in isolation. A verification failure is a definitive
  // sign-out: the token is malformed/expired/tampered with and must never be
  // trusted again.
  let payload: Awaited<ReturnType<typeof verifyToken>>;
  try {
    payload = await verifyToken(refreshToken, "refresh");
  } catch {
    await recordAuthAudit({
      action: "refresh",
      success: false,
      detail: "Refresh failed (invalid token)",
      ...requestMeta,
    });

    const response = NextResponse.json({ error: "Invalid refresh token" }, { status: HTTP_UNAUTHORIZED });
    clearAuthCookies(response);
    return response;
  }

  try {
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

      // Preserve auth for the in-flight request while another tab/request finishes rotation.
      const racedAccessToken = await signAccessToken(payload.uid, payload.email);
      setAccessAuthCookie(response, racedAccessToken);

      await recordAuthAudit({
        action: "refresh",
        success: true,
        detail: "Refresh already rotated by a parallel request",
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
        detail: "Refresh failed (session not found/expired/revoked)",
        ...requestMeta,
      });

      const response = NextResponse.json({ error: "Invalid refresh token" }, { status: HTTP_UNAUTHORIZED });
      clearAuthCookies(response);
      return response;
    }

    // Transient failure (DB hiccup, transaction timeout, etc.). The refresh
    // token may still be valid, so keep the session cookies and return 503 —
    // the client treats this as "unavailable" and retries on the next poll.
    await recordAuthAudit({
      action: "refresh",
      success: false,
      email: payload.email,
      userId: payload.uid,
      detail: "Refresh failed (transient)",
      ...requestMeta,
    });

    return NextResponse.json({ error: "Refresh temporarily unavailable" }, { status: 503 });
  }
}
