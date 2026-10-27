import { NextRequest } from "next/server";

import {
  proxy,
  resolveMobilePathname,
  isStaticAssetPath,
  isMobileOrTabletRequest,
  isMetadataCrawlerRequest,
  isConfidentWalkerRequest,
} from "@/proxy";

const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
const CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

function makeRequest(pathname: string, headers: Record<string, string> = {}, method = "GET") {
  const url = new URL(`http://localhost:3000${pathname}`);
  return new NextRequest(url, { method, headers });
}

function isRedirect(res: { status: number }) {
  return res.status >= 300 && res.status < 400;
}

describe("resolveMobilePathname", () => {
  it("maps the home route to /m", () => {
    expect(resolveMobilePathname("/")).toBe("/m");
  });

  it("preserves the magazine path under /m", () => {
    expect(resolveMobilePathname("/magazine/some-article")).toBe("/m/magazine/some-article");
  });

  it("maps auth routes to their mobile equivalents", () => {
    expect(resolveMobilePathname("/register")).toBe("/m/register");
    expect(resolveMobilePathname("/reset-password/token")).toBe("/m/reset-password");
    expect(resolveMobilePathname("/verify-email/token")).toBe("/m/verify-email");
  });

  it("maps unknown content routes to /m root", () => {
    expect(resolveMobilePathname("/new")).toBe("/m");
    expect(resolveMobilePathname("/categories")).toBe("/m");
  });
});

describe("isStaticAssetPath", () => {
  it("identifies asset extensions and asset prefixes", () => {
    expect(isStaticAssetPath("/images/logo.png")).toBe(true);
    expect(isStaticAssetPath("/favicons/favicon.ico")).toBe(true);
    expect(isStaticAssetPath("/sounds/click.mp3")).toBe(true);
    expect(isStaticAssetPath("/styles.css")).toBe(true);
  });

  it("does not treat normal pages as assets", () => {
    expect(isStaticAssetPath("/")).toBe(false);
    expect(isStaticAssetPath("/new")).toBe(false);
    expect(isStaticAssetPath("/api/favourites")).toBe(false);
  });
});

describe("isMobileOrTabletRequest", () => {
  it("detects iPhone and Android user agents", () => {
    expect(isMobileOrTabletRequest(makeRequest("/", { "user-agent": MOBILE_UA }))).toBe(true);
    expect(isMobileOrTabletRequest(makeRequest("/", { "user-agent": ANDROID_UA }))).toBe(true);
  });

  it("honors the sec-ch-ua-mobile client hint", () => {
    expect(isMobileOrTabletRequest(makeRequest("/", { "sec-ch-ua-mobile": "?1", "user-agent": DESKTOP_UA }))).toBe(true);
  });

  it("returns false for desktop user agents", () => {
    expect(isMobileOrTabletRequest(makeRequest("/", { "user-agent": DESKTOP_UA }))).toBe(false);
  });
});

describe("isMetadataCrawlerRequest", () => {
  it("identifies crawlers that must never be redirected", () => {
    expect(isMetadataCrawlerRequest(makeRequest("/", { "user-agent": CRAWLER_UA }))).toBe(true);
  });

  it("returns false for real browsers", () => {
    expect(isMetadataCrawlerRequest(makeRequest("/", { "user-agent": DESKTOP_UA }))).toBe(false);
  });
});

describe("proxy mobile routing", () => {
  it("redirects a mobile browser on / to /m", () => {
    const res = proxy(makeRequest("/", { "user-agent": MOBILE_UA }));
    expect(isRedirect(res)).toBe(true);
    expect(res.headers.get("location")).toContain("/m");
  });

  it("preserves query string on the mobile redirect", () => {
    const res = proxy(makeRequest("/?v=abc123", { "user-agent": MOBILE_UA }));
    expect(res.headers.get("location")).toContain("v=abc123");
  });

  it("does not redirect a desktop browser", () => {
    const res = proxy(makeRequest("/", { "user-agent": DESKTOP_UA }));
    expect(isRedirect(res)).toBe(false);
  });

  it("does not redirect API routes", () => {
    const res = proxy(makeRequest("/api/favourites", { "user-agent": MOBILE_UA }));
    expect(isRedirect(res)).toBe(false);
  });

  it("does not redirect when already under /m (no loop)", () => {
    const res = proxy(makeRequest("/m", { "user-agent": MOBILE_UA }));
    expect(isRedirect(res)).toBe(false);
  });

  it("does not redirect share, embed, sitemap, or desktop-only routes", () => {
    for (const pathname of ["/s/abc123", "/share/abc123", "/embed/abc123", "/sitemap.xml", "/desktop-only"]) {
      const res = proxy(makeRequest(pathname, { "user-agent": MOBILE_UA }));
      expect(isRedirect(res)).toBe(false);
    }
  });

  it("does not redirect desktop-only content routes (forum, profiles, playlists, history)", () => {
    for (const pathname of ["/forum", "/u/someone", "/playlists", "/history"]) {
      const res = proxy(makeRequest(pathname, { "user-agent": MOBILE_UA }));
      expect(isRedirect(res)).toBe(false);
    }
  });

  it("does not redirect static assets", () => {
    const res = proxy(makeRequest("/images/logo.png", { "user-agent": MOBILE_UA }));
    expect(isRedirect(res)).toBe(false);
  });

  it("does not redirect metadata crawlers", () => {
    const res = proxy(makeRequest("/magazine/x", { "user-agent": CRAWLER_UA }));
    expect(isRedirect(res)).toBe(false);
  });

  it("does not redirect non-GET/HEAD requests", () => {
    const res = proxy(makeRequest("/", { "user-agent": MOBILE_UA }, "POST"));
    expect(isRedirect(res)).toBe(false);
  });
});

describe("proxy security headers", () => {
  it("sets X-Frame-Options DENY on normal pages", () => {
    const res = proxy(makeRequest("/", { "user-agent": DESKTOP_UA }));
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("does not set X-Frame-Options DENY on /embed (must stay frameable)", () => {
    const res = proxy(makeRequest("/embed/abc123", { "user-agent": DESKTOP_UA }));
    expect(res.headers.get("X-Frame-Options")).toBeNull();
  });

  it("sets X-Content-Type-Options nosniff", () => {
    const res = proxy(makeRequest("/", { "user-agent": DESKTOP_UA }));
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("sets Referrer-Policy", () => {
    const res = proxy(makeRequest("/", { "user-agent": DESKTOP_UA }));
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });
});

describe("confident walker decoy dump", () => {
  const WALKER_PATH = "/artist/some-slug?letter=A&resume=1&v=dQw4w9WgXcQ";

  it("detects the alphabetical-walk signature", () => {
    expect(isConfidentWalkerRequest(makeRequest(WALKER_PATH, { "user-agent": DESKTOP_UA }))).toBe(true);
  });

  it("ignores partial signatures and non-artist routes", () => {
    expect(isConfidentWalkerRequest(makeRequest("/artist/some-slug", { "user-agent": DESKTOP_UA }))).toBe(false);
    expect(isConfidentWalkerRequest(makeRequest("/artist/some-slug?letter=A", { "user-agent": DESKTOP_UA }))).toBe(false);
    expect(isConfidentWalkerRequest(makeRequest("/artist/some-slug?letter=A&resume=1", { "user-agent": DESKTOP_UA }))).toBe(false);
    expect(isConfidentWalkerRequest(makeRequest("/new?letter=A&resume=1&v=x", { "user-agent": DESKTOP_UA }))).toBe(false);
    expect(isConfidentWalkerRequest(makeRequest(WALKER_PATH, { "user-agent": DESKTOP_UA }, "POST"))).toBe(false);
  });

  it("ignores signed-in users", () => {
    expect(isConfidentWalkerRequest(makeRequest(WALKER_PATH, { "user-agent": DESKTOP_UA, cookie: "ytr_access=abc" }))).toBe(false);
    expect(isConfidentWalkerRequest(makeRequest(WALKER_PATH, { "user-agent": DESKTOP_UA, cookie: "ytr_refresh=abc" }))).toBe(false);
  });

  it("returns a JSON decoy dump for a confident walker", async () => {
    const previous = process.env.DECOY_DUMP_BYTES;
    process.env.DECOY_DUMP_BYTES = "16384";
    try {
      const res = proxy(makeRequest(WALKER_PATH, { "user-agent": DESKTOP_UA }));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
      const body = await res.text();
      expect(JSON.parse(body)).toBeInstanceOf(Array);
    } finally {
      if (previous === undefined) {
        delete process.env.DECOY_DUMP_BYTES;
      } else {
        process.env.DECOY_DUMP_BYTES = previous;
      }
    }
  });

  it("passes a normal artist page through unchanged", () => {
    const res = proxy(makeRequest("/artist/some-slug?letter=A", { "user-agent": DESKTOP_UA }));
    const contentType = res.headers.get("content-type");
    expect(contentType ?? "").not.toContain("application/json");
  });
});
