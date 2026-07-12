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
const METADATA_CRAWLER_USER_AGENT_PATTERN = /facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|discordbot|whatsapp|telegrambot|googlebot|google-inspectiontool|adsbot-google|bingbot|bingpreview|duckduckbot|applebot/i;

function isProtectedApi(pathname: string) {
  return PROTECTED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isAuthOptionalApi(pathname: string) {
  return AUTH_OPTIONAL_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// Static assets from public/ must never be redirected — browsers requesting
// images, fonts, favicons etc. need the actual file, not a mobile page.
export function isStaticAssetPath(pathname: string): boolean {
  return /\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?|ttf|eot|otf|mp3|mp4|webm|ogg|pdf|xml|txt|json|map)$/i.test(pathname) ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/favicons/") ||
    pathname.startsWith("/sounds/");
}

export function resolveMobilePathname(pathname: string): string {
  // Routes that have /m equivalents — preserve the path so the mobile
  // page for that content loads directly.
  if (pathname.startsWith("/magazine")) {
    return "/m" + pathname;
  }
  if (pathname === "/register") {
    return "/m/register";
  }
  if (pathname.startsWith("/reset-password")) {
    return "/m/reset-password";
  }
  if (pathname.startsWith("/verify-email")) {
    return "/m/verify-email";
  }
  // Default: all other routes (home, new, categories, etc.) land on /m
  // with query string intact for shared video links (?v=abc123).
  return "/m";
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

function withSecurityHeaders(response: NextResponse, pathname = "") {
  if (!pathname.startsWith("/embed/")) {
    response.headers.set("X-Frame-Options", "DENY");
  }
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

  // Static assets must never be redirected — the config.matcher exclusion
  // for _next/static can fail under Turbopack HMR when chunk hashes change.
  if (pathname.startsWith("/_next/static") || pathname.startsWith("/_next/image")) {
    return NextResponse.next();
  }

  const requestHeaders = sanitizedAuthHeaders(request);
  requestHeaders.set("x-ytr-pathname", pathname);
  requestHeaders.set("x-ytr-search", request.nextUrl.search);

  const isBrowserPageRequest = request.method === "GET" || request.method === "HEAD";
  const isStaticAsset = isStaticAssetPath(pathname);

  const isShareRoute = pathname.startsWith("/s/") || pathname.startsWith("/share/");
  const isEmbedRoute = pathname.startsWith("/embed/");
  const isSitemapOrRobotsRequest = pathname.startsWith("/sitemap") || pathname === "/robots.txt";
  const isMetadataCrawler = isMetadataCrawlerRequest(request);
  // Routes that have no mobile equivalent yet — they fall through to the
  // desktop layout so shared links (forum, profiles) still resolve rather
  // than losing the user at /m. Plan: add mobile forum/profile pages in a
  // follow-up and move those routes into resolveMobilePathname.
  const isDesktopOnlyContentRoute =
    pathname.startsWith("/forum") ||
    pathname.startsWith("/u/") ||
    pathname.startsWith("/playlists") ||
    pathname === "/history";
  const shouldRedirectToMobile =
    isBrowserPageRequest
    && !isStaticAsset
    && !pathname.startsWith("/api")
    && pathname !== "/desktop-only"
    && !pathname.startsWith("/m")
    && !isShareRoute
    && !isEmbedRoute
    && !isSitemapOrRobotsRequest
    && !isMetadataCrawler
    && !isDesktopOnlyContentRoute
    && isMobileOrTabletRequest(request);

  // For browser page navigations (non-API), silently refresh when the access
  // token is absent/expired but a refresh token is present, so returning users
  // are transparently re-authenticated instead of hitting the auth gate.
  const isBrowserPageNav =
    isBrowserPageRequest
    && !pathname.startsWith("/api")
    && pathname !== "/desktop-only"
    && !pathname.startsWith("/m")
    && !isEmbedRoute
    && !isSitemapOrRobotsRequest
    && !isMetadataCrawler;

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
      return withSecurityHeaders(NextResponse.redirect(silentRefreshUrl), pathname);
    }
  }

  // Mobile redirect runs *after* silent refresh so mobile returning users
  // get their session refreshed before being redirected to /m.
  if (shouldRedirectToMobile) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = resolveMobilePathname(pathname);
    return withSecurityHeaders(NextResponse.redirect(redirectUrl), pathname);
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
      pathname,
    );
  }

  if (!isProtectedApi(pathname)) {
    return withSecurityHeaders(
      NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      }),
      pathname,
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
        pathname,
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
    pathname,
  );
}