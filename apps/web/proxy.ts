import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy middleware (Next.js 16 `proxy.ts`).
 *
 * Responsibilities:
 * 1. Inject `x-ytr-pathname` / `x-ytr-search` so the shell layout can resolve
 *    the requested video server-side for shared links (no flash-of-wrong-video).
 * 2. Redirect mobile/tablet browsers to the `/m` mobile experience, preserving
 *    the path for routes that have a mobile equivalent.
 * 3. Apply baseline security headers (clickjacking, MIME sniffing, referrer,
 *    feature policy, HSTS in production).
 *
 * REGRESSION NOTE: a previous refactor (commit cb56dd99) removed the mobile
 * redirect and security headers as "unused" — they were load-bearing. The
 * invariant script scripts/verify-proxy-mobile-routing-invariants.js and the
 * vitest suite apps/web/proxy.test.ts now guard every behavior below. Do not
 * remove any of the three together.
 */

const MOBILE_OR_TABLET_USER_AGENT_PATTERN = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Windows Phone|Opera Mini|Mobile|Tablet|Kindle|Silk|PlayBook/i;
const METADATA_CRAWLER_USER_AGENT_PATTERN = /facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|discordbot|whatsapp|telegrambot|googlebot|google-inspectiontool|adsbot-google|bingbot|bingpreview|duckduckbot|applebot/i;

/**
 * Static assets from public/ must never be redirected — browsers requesting
 * images, fonts, favicons etc. need the actual file, not a mobile page.
 */
export function isStaticAssetPath(pathname: string): boolean {
  return /\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?|ttf|eot|otf|mp3|mp4|webm|ogg|pdf|xml|txt|json|map)$/i.test(pathname) ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/favicons/") ||
    pathname.startsWith("/sounds/");
}

/**
 * Map a desktop route to its mobile equivalent. Routes without a dedicated
 * mobile page land on `/m` with the query string intact (e.g. shared video
 * links `?v=abc123`).
 */
export function resolveMobilePathname(pathname: string): string {
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
  return "/m";
}

export function isMobileOrTabletRequest(request: NextRequest): boolean {
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

export function isMetadataCrawlerRequest(request: NextRequest): boolean {
  const userAgent = request.headers.get("user-agent") ?? "";
  return METADATA_CRAWLER_USER_AGENT_PATTERN.test(userAgent);
}

export function withSecurityHeaders(response: NextResponse, pathname = ""): NextResponse {
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

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Static assets must never be redirected — the config.matcher exclusion
  // for _next/static can fail under Turbopack HMR when chunk hashes change.
  if (pathname.startsWith("/_next/static") || pathname.startsWith("/_next/image")) {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);
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
  // than losing the user at /m.
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

  if (shouldRedirectToMobile) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = resolveMobilePathname(pathname);
    return withSecurityHeaders(NextResponse.redirect(redirectUrl), pathname);
  }

  return withSecurityHeaders(
    NextResponse.next({
      request: { headers: requestHeaders },
    }),
    pathname,
  );
}
