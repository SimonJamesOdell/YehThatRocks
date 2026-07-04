import { describe, expect, it } from "vitest";

import { isStaticAssetPath, resolveMobilePathname } from "@/proxy";

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
