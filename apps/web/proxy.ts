import { NextRequest, NextResponse } from "next/server";

import { buildDecoyCatalogDump } from "@/lib/decoy-artists";

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
 * Emergency "I'm under attack" mode. When enabled, cold clients (no `ytr_botok`
 * proof-of-work cookie) are redirected to /challenge before any page is served.
 * This is a coarse load-shedding lever; the strong HMAC verification still
 * happens at the origin (server-side trust gate) and the /challenge page issues
 * a real cookie after a genuine solve.
 */
const ATTACK_MODE_ENABLED = process.env.ATTACK_MODE === "1" || process.env.ATTACK_MODE === "true";

function hasPlausibleBotOkCookie(request: NextRequest): boolean {
  const value = request.cookies.get("ytr_botok")?.value;
  if (!value) {
    return false;
  }

  const parts = value.split(":");
  return (
    parts.length === 3
    && /^[0-9a-f]{1,128}$/i.test(parts[0] ?? "")
    && /^\d{1,16}$/.test(parts[1] ?? "")
  );
}

/**
 * The catalog walker's tell: GET /artist/<slug>?letter=X&resume=1&v=<id> with
 * no session cookies. This exact combination is what the nginx challenge
 * already flags, so by the time a request reaches the proxy it has either
 * solved the proof-of-work (real walker) or is a rare signed-in deep-link
 * (excluded below). Confident enough to answer with the decoy dump.
 */
const WALKER_DECOY_DEFAULT_BYTES = 256 * 1024;
const WALKER_DECOY_MIN_BYTES = 16 * 1024;
const WALKER_DECOY_MAX_BYTES = 64 * 1024 * 1024;

function isWalkerDecoyDumpEnabled(): boolean {
  const raw = process.env.DECOY_DUMP_ENABLED ?? "1";
  return raw !== "0" && raw !== "false";
}

function walkerDecoyTargetBytes(): number {
  const raw = Number(process.env.DECOY_DUMP_BYTES ?? WALKER_DECOY_DEFAULT_BYTES);
  if (!Number.isFinite(raw)) {
    return WALKER_DECOY_DEFAULT_BYTES;
  }
  return Math.max(WALKER_DECOY_MIN_BYTES, Math.min(WALKER_DECOY_MAX_BYTES, Math.floor(raw)));
}

export function isConfidentWalkerRequest(request: NextRequest): boolean {
  if (request.method !== "GET") {
    return false;
  }

  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/artist/")) {
    return false;
  }

  const params = request.nextUrl.searchParams;
  const letter = params.get("letter");
  const resume = params.get("resume");
  const v = params.get("v");
  if (!letter || !v || resume !== "1") {
    return false;
  }

  // Signed-in users are never the walker (nginx also skips them).
  if (request.cookies.get("ytr_access") || request.cookies.get("ytr_refresh")) {
    return false;
  }

  return true;
}

function buildWalkerDecoyDumpResponse(): NextResponse {
  const body = buildDecoyCatalogDump(walkerDecoyTargetBytes());
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Ytr-Volunteer": "enjoy the full catalog, friend",
    },
  });
}

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

  // Answer a confident catalog walker with one big blob of synthetic catalog
  // instead of the real page. The walker gets its "efficient download", but
  // every slug and video ID in it is manufactured.
  if (isWalkerDecoyDumpEnabled() && isConfidentWalkerRequest(request)) {
    return withSecurityHeaders(buildWalkerDecoyDumpResponse(), pathname);
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

  if (ATTACK_MODE_ENABLED) {
    const isChallengeRoute = pathname === "/challenge";
    const shouldChallenge =
      request.method === "GET"
      && !isStaticAsset
      && !pathname.startsWith("/api")
      && !isShareRoute
      && !isEmbedRoute
      && !isSitemapOrRobotsRequest
      && !isMetadataCrawler
      && !isChallengeRoute
      && !hasPlausibleBotOkCookie(request);

    if (shouldChallenge) {
      const challengeUrl = request.nextUrl.clone();
      challengeUrl.pathname = "/challenge";
      challengeUrl.search = "";
      challengeUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
      return withSecurityHeaders(NextResponse.redirect(challengeUrl), pathname);
    }
  }

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
