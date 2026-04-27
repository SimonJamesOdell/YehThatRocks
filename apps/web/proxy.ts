import { NextRequest, NextResponse } from "next/server";

import { readAuthCookies } from "@/lib/auth-cookies";
import { verifyToken } from "@/lib/auth-jwt";

const AUTH_OPTIONAL_API_PREFIXES = [
  "/api/chat",
  "/api/chat/stream",
];

const PROTECTED_API_PREFIXES = [
  "/api/favourites",
  "/api/watch-history",
  "/api/playlists",
  "/api/videos/unavailable",
  "/api/auth/change-password",
  "/api/auth/me",
  "/api/auth/send-verification",
];

const MOBILE_OR_TABLET_USER_AGENT_PATTERN = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Windows Phone|Opera Mini|Mobile|Tablet|Kindle|Silk|PlayBook/i;
const METADATA_CRAWLER_USER_AGENT_PATTERN = /facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|discordbot|whatsapp|telegrambot|googlebot|bingbot|duckduckbot|applebot/i;

function isProtectedApi(pathname: string) {
  return PROTECTED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isAuthOptionalApi(pathname: string) {
  return AUTH_OPTIONAL_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isMobileOrTabletRequest(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") ?? "";
  const secChUaMobile = request.headers.get("sec-ch-ua-mobile");
  const secChUaPlatform = request.headers.get("sec-ch-ua-platform") ?? "";

  if (secChUaMobile === "?1") {
    return true;
  }

  if (/Android|iOS/i.test(secChUaPlatform)) {
    return true;
  }

  return MOBILE_OR_TABLET_USER_AGENT_PATTERN.test(userAgent);
}

function isMetadataCrawlerRequest(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") ?? "";
  return METADATA_CRAWLER_USER_AGENT_PATTERN.test(userAgent);
}

function sanitizedAuthHeaders(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-auth-user-id");
  requestHeaders.delete("x-auth-user-email");
  requestHeaders.delete("x-auth-verified");
  return requestHeaders;
}

function withSecurityHeaders(response: NextResponse) {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("X-DNS-Prefetch-Control", "off");

  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }

  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestHeaders = sanitizedAuthHeaders(request);

  const isBrowserPageRequest = request.method === "GET" || request.method === "HEAD";
  const isShareRoute = pathname.startsWith("/s/") || pathname.startsWith("/share/");
  const isMetadataCrawler = isMetadataCrawlerRequest(request);
  const shouldRedirectToDesktopOnly =
    isBrowserPageRequest
    && !pathname.startsWith("/api")
    && pathname !== "/desktop-only"
    && !isShareRoute
    && !isMetadataCrawler
    && isMobileOrTabletRequest(request);

  if (shouldRedirectToDesktopOnly) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/desktop-only";
    redirectUrl.search = "";
    return withSecurityHeaders(NextResponse.redirect(redirectUrl));
  }

  // For browser page navigations (non-API), silently refresh when the access
  // token is absent/expired but a refresh token is present, so returning users
  // are transparently re-authenticated instead of hitting the auth gate.
  const isBrowserPageNav =
    isBrowserPageRequest
    && !pathname.startsWith("/api")
    && pathname !== "/desktop-only";

  if (isBrowserPageNav) {
    const { accessToken: maybeAccess, refreshToken } = readAuthCookies(request);
    let accessTokenValid = false;
    if (maybeAccess) {
      try {
        await verifyToken(maybeAccess, "access");
        accessTokenValid = true;
      } catch {
        // expired or invalid — fall through
      }
    }
    if (!accessTokenValid && refreshToken) {
      const silentRefreshUrl = request.nextUrl.clone();
      silentRefreshUrl.pathname = "/api/auth/silent-refresh";
      const next = pathname + (request.nextUrl.search ?? "");
      silentRefreshUrl.search = `?next=${encodeURIComponent(next)}`;
      return withSecurityHeaders(NextResponse.redirect(silentRefreshUrl));
    }
  }

  const { accessToken } = readAuthCookies(request);

  if (isAuthOptionalApi(pathname)) {
    if (accessToken) {
      try {
        const access = await verifyToken(accessToken, "access");
        requestHeaders.set("x-auth-user-id", String(access.uid));
        requestHeaders.set("x-auth-user-email", access.email);
        requestHeaders.set("x-auth-verified", "1");
      } catch {
        // Invalid token falls through as guest access for public chat reads.
      }
    }

    return withSecurityHeaders(
      NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      }),
    );
  }

  if (!isProtectedApi(pathname)) {
    return withSecurityHeaders(
      NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      }),
    );
  }

  if (accessToken) {
    try {
      const access = await verifyToken(accessToken, "access");
      requestHeaders.set("x-auth-user-id", String(access.uid));
      requestHeaders.set("x-auth-user-email", access.email);
      requestHeaders.set("x-auth-verified", "1");

      return withSecurityHeaders(
        NextResponse.next({
          request: {
            headers: requestHeaders,
          },
        }),
      );
    } catch {
      // Invalid token falls through to unauthorized response.
    }
  }

  return withSecurityHeaders(
    NextResponse.json(
      {
        error: "Unauthorized",
      },
      { status: 401 },
    ),
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
