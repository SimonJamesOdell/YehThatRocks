import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mock fns — initialized before module imports ───────────────────
const { mockReadAuthCookies, mockVerifyToken } = vi.hoisted(() => ({
  mockReadAuthCookies: vi.fn(),
  mockVerifyToken: vi.fn(),
}));

vi.mock("@/lib/auth-cookies", () => ({
  readAuthCookies: mockReadAuthCookies,
  setAccessAuthCookie: vi.fn(),
  setAuthCookies: vi.fn(),
  clearAuthCookies: vi.fn(),
}));

vi.mock("@/lib/auth-jwt", () => ({
  verifyToken: mockVerifyToken,
  signAccessToken: vi.fn(),
  signRefreshToken: vi.fn(),
  isTokenValidationError: vi.fn().mockReturnValue(true),
}));

vi.stubEnv("AUTH_JWT_SECRET", "test-secret-at-least-32-characters-long!!");
vi.stubEnv("NODE_ENV", "development");

import { isStaticAssetPath, resolveMobilePathname, proxy } from "@/proxy";

describe("isStaticAssetPath", () => {
  it("matches image file extensions", () => {
    expect(isStaticAssetPath("/assets/images/yeh_main_logo.png")).toBe(true);
    expect(isStaticAssetPath("/images/photo.jpg")).toBe(true);
    expect(isStaticAssetPath("/images/photo.jpeg")).toBe(true);
    expect(isStaticAssetPath("/icons/spinner.gif")).toBe(true);
    expect(isStaticAssetPath("/icons/logo.svg")).toBe(true);
    expect(isStaticAssetPath("/icons/logo.webp")).toBe(true);
    expect(isStaticAssetPath("/favicon.ico")).toBe(true);
  });

  it("matches other static file extensions", () => {
    expect(isStaticAssetPath("/styles/main.css")).toBe(true);
    expect(isStaticAssetPath("/scripts/app.js")).toBe(true);
    expect(isStaticAssetPath("/fonts/rock.woff2")).toBe(true);
    expect(isStaticAssetPath("/fonts/rock.woff")).toBe(true);
    expect(isStaticAssetPath("/fonts/rock.ttf")).toBe(true);
    expect(isStaticAssetPath("/fonts/rock.eot")).toBe(true);
    expect(isStaticAssetPath("/fonts/rock.otf")).toBe(true);
    expect(isStaticAssetPath("/sounds/bell.mp3")).toBe(true);
    expect(isStaticAssetPath("/videos/intro.mp4")).toBe(true);
    expect(isStaticAssetPath("/videos/intro.webm")).toBe(true);
    expect(isStaticAssetPath("/audio/clip.ogg")).toBe(true);
    expect(isStaticAssetPath("/docs/report.pdf")).toBe(true);
    expect(isStaticAssetPath("/data/config.xml")).toBe(true);
    expect(isStaticAssetPath("/data/readme.txt")).toBe(true);
    expect(isStaticAssetPath("/data/response.json")).toBe(true);
    expect(isStaticAssetPath("/scripts/app.js.map")).toBe(true);
  });

  it("matches static asset directory prefixes", () => {
    expect(isStaticAssetPath("/assets/anything")).toBe(true);
    expect(isStaticAssetPath("/images/photo")).toBe(true);
    expect(isStaticAssetPath("/favicons/favicon-32x32.png")).toBe(true);
    expect(isStaticAssetPath("/sounds/bell")).toBe(true);
  });

  it("is case-insensitive for extensions", () => {
    expect(isStaticAssetPath("/images/LOGO.PNG")).toBe(true);
    expect(isStaticAssetPath("/images/Logo.Jpg")).toBe(true);
    expect(isStaticAssetPath("/styles/main.CSS")).toBe(true);
  });

  it("returns false for page routes", () => {
    expect(isStaticAssetPath("/")).toBe(false);
    expect(isStaticAssetPath("/m")).toBe(false);
    expect(isStaticAssetPath("/m/new")).toBe(false);
    expect(isStaticAssetPath("/magazine")).toBe(false);
    expect(isStaticAssetPath("/forum")).toBe(false);
    expect(isStaticAssetPath("/artists")).toBe(false);
    expect(isStaticAssetPath("/top100")).toBe(false);
    expect(isStaticAssetPath("/search")).toBe(false);
    expect(isStaticAssetPath("/login")).toBe(false);
    expect(isStaticAssetPath("/register")).toBe(false);
  });

  it("returns false for API routes", () => {
    expect(isStaticAssetPath("/api/chat")).toBe(false);
    expect(isStaticAssetPath("/api/auth/me")).toBe(false);
    expect(isStaticAssetPath("/api/videos")).toBe(false);
  });

  it("returns false for share and embed routes", () => {
    expect(isStaticAssetPath("/s/abc123")).toBe(false);
    expect(isStaticAssetPath("/share/abc123")).toBe(false);
    expect(isStaticAssetPath("/embed/abc123")).toBe(false);
  });

  it("handles edge cases", () => {
    expect(isStaticAssetPath("")).toBe(false);
    expect(isStaticAssetPath("/api")).toBe(false);
  });
});

describe("resolveMobilePathname", () => {
  it("maps /magazine routes to /m/magazine preserving the sub-path", () => {
    expect(resolveMobilePathname("/magazine")).toBe("/m/magazine");
    expect(resolveMobilePathname("/magazine/my-article")).toBe("/m/magazine/my-article");
    expect(resolveMobilePathname("/magazine/deep/nested/path")).toBe("/m/magazine/deep/nested/path");
  });

  it("maps /register to /m/register", () => {
    expect(resolveMobilePathname("/register")).toBe("/m/register");
  });

  it("maps /reset-password to /m/reset-password with sub-paths preserved", () => {
    expect(resolveMobilePathname("/reset-password")).toBe("/m/reset-password");
    expect(resolveMobilePathname("/reset-password/confirm")).toBe("/m/reset-password");
  });

  it("maps /verify-email to /m/verify-email with sub-paths preserved", () => {
    expect(resolveMobilePathname("/verify-email")).toBe("/m/verify-email");
    expect(resolveMobilePathname("/verify-email/callback")).toBe("/m/verify-email");
  });

  it("falls back to /m for unmapped routes", () => {
    expect(resolveMobilePathname("/")).toBe("/m");
    expect(resolveMobilePathname("/new")).toBe("/m");
    expect(resolveMobilePathname("/categories/thrash")).toBe("/m");
    expect(resolveMobilePathname("/forum")).toBe("/m");
    expect(resolveMobilePathname("/forum/thread/123")).toBe("/m");
    expect(resolveMobilePathname("/u/someuser")).toBe("/m");
    expect(resolveMobilePathname("/history")).toBe("/m");
    expect(resolveMobilePathname("/playlists")).toBe("/m");
    expect(resolveMobilePathname("/search")).toBe("/m");
    expect(resolveMobilePathname("/top100")).toBe("/m");
  });

  it("preserves the original pathname intent — /m prefix is not doubled", () => {
    expect(resolveMobilePathname("/m")).toBe("/m");
    expect(resolveMobilePathname("/m/categories")).toBe("/m");
  });

  it("handles edge cases: empty string, query-like paths", () => {
    expect(resolveMobilePathname("")).toBe("/m");
    expect(resolveMobilePathname("/?v=abc")).toBe("/m");
  });
});

// ── Auth persistence: proxy middleware behavior ─────────────────────────────

/**
 * Creates a NextURL-like object that the proxy can read/write and
 * NextResponse.redirect() can serialize.
 */
function createNextUrl(pathname: string, search: string) {
  const url = new URL(`https://yehthatrocks.com${pathname}${search}`);
  // Attach clone to a plain URL — writable pathname/search come for free.
  (url as any).clone = () => createNextUrl(url.pathname, url.search);
  return url as URL & { clone(): ReturnType<typeof createNextUrl> };
}

function mockRequest(overrides: {
  method?: string;
  pathname?: string;
  search?: string;
  cookies?: Record<string, string>;
  userAgent?: string;
} = {}) {
  const {
    method = "GET",
    pathname = "/",
    search = "",
    cookies = {},
    userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140",
  } = overrides;

  const cookieMap = new Map(Object.entries(cookies));
  const nextUrl = createNextUrl(pathname, search);

  return {
    method,
    nextUrl,
    url: nextUrl.href,
    cookies: {
      get(name: string) {
        const value = cookieMap.get(name);
        return value ? { value, name } : undefined;
      },
    },
    headers: new Headers({
      "user-agent": userAgent,
      "x-forwarded-for": "127.0.0.1",
    }),
  } as unknown as import("next/server").NextRequest;
}

/**
 * Helper: extracts the Location header from a redirect response, or null.
 */
function redirectLocation(response: Response | null): string | null {
  if (!response) return null;
  return response.headers.get("Location");
}

describe("proxy auth persistence", () => {
  beforeEach(() => {
    mockReadAuthCookies.mockReset();
    mockVerifyToken.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Unauthenticated user: no cookies ────────────────────────────────────
  it("passes through when no tokens are present", async () => {
    mockReadAuthCookies.mockReturnValue({
      accessToken: undefined,
      refreshToken: undefined,
    });

    const req = mockRequest({ pathname: "/" });
    const res = await proxy(req);

    // Should not redirect — user is just a guest
    expect(redirectLocation(res)).toBeNull();
    expect(res.status).not.toBe(302);
  });

  // ── Authenticated user: valid access token ──────────────────────────────
  it("passes through when access token is valid", async () => {
    mockReadAuthCookies.mockReturnValue({
      accessToken: "valid-access-token",
      refreshToken: "valid-refresh-token",
    });
    mockVerifyToken.mockResolvedValue({ uid: 1, email: "test@test.com" });

    const req = mockRequest({ pathname: "/" });
    const res = await proxy(req);

    // Should not redirect — user is authenticated
    expect(redirectLocation(res)).toBeNull();
    expect(mockVerifyToken).toHaveBeenCalled();
  });

  // ── Returning user: expired access token, valid refresh token ───────────
  it("redirects to silent-refresh when access token is expired but refresh token exists", async () => {
    mockReadAuthCookies.mockReturnValue({
      accessToken: "expired-access-token",
      refreshToken: "valid-refresh-token",
    });
    // Access token verification fails (expired)
    mockVerifyToken.mockRejectedValue(new Error("JWTExpired"));

    const req = mockRequest({ pathname: "/" });
    const res = await proxy(req);

    // Should redirect to silent-refresh with the original path as `next`
    const location = redirectLocation(res);
    expect(location).not.toBeNull();
    expect(location!).toContain("/api/auth/silent-refresh");
    expect(location!).toContain("next=");
  });

  // ── Returning user: missing refresh token ───────────────────────────────
  it("passes through when access token is expired and no refresh token exists", async () => {
    mockReadAuthCookies.mockReturnValue({
      accessToken: "expired-access-token",
      refreshToken: undefined,
    });
    mockVerifyToken.mockRejectedValue(new Error("JWTExpired"));

    const req = mockRequest({ pathname: "/" });
    const res = await proxy(req);

    // No refresh token to use — user must re-authenticate
    expect(redirectLocation(res)).toBeNull();
  });

  // ── API routes: silent refresh never triggers on API calls ──────────────
  it("does not trigger silent refresh for API POST requests", async () => {
    mockReadAuthCookies.mockReturnValue({
      accessToken: "expired-access-token",
      refreshToken: "valid-refresh-token",
    });

    const req = mockRequest({ method: "POST", pathname: "/api/auth/login" });
    const res = await proxy(req);

    // Silent refresh only applies to GET/HEAD browser navigations
    expect(redirectLocation(res)).toBeNull();
    // verifyToken should not be called for POST (isBrowserPageNav is false)
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });

  // ── Returning user with query string: preserves search params ───────────
  it("preserves search params in the silent-refresh redirect", async () => {
    mockReadAuthCookies.mockReturnValue({
      accessToken: "expired-access-token",
      refreshToken: "valid-refresh-token",
    });
    mockVerifyToken.mockRejectedValue(new Error("JWTExpired"));

    const req = mockRequest({
      pathname: "/",
      search: "?v=abc123&from=facebook",
    });
    const res = await proxy(req);

    const location = redirectLocation(res);
    expect(location).not.toBeNull();
    // The next parameter should encode the full path + search
    expect(location!).toContain("next=");
    expect(location!).toContain(encodeURIComponent("/?v=abc123&from=facebook"));
  });

  // ── Mobile returning user: silent refresh before mobile redirect ────────
  it("triggers silent refresh for mobile users before mobile redirect", async () => {
    mockReadAuthCookies.mockReturnValue({
      accessToken: "expired-access-token",
      refreshToken: "valid-refresh-token",
    });
    mockVerifyToken.mockRejectedValue(new Error("JWTExpired"));

    // Mobile user-agent — silent refresh must fire before mobile redirect
    const req = mockRequest({
      pathname: "/",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)",
    });
    const res = await proxy(req);

    // Should redirect to silent-refresh first (NOT to /m)
    const location = redirectLocation(res);
    expect(location).not.toBeNull();
    // Must NOT be a mobile redirect — silent refresh comes first
    expect(location!).not.toContain("/m");
    expect(location!).toContain("/api/auth/silent-refresh");
  });
});
