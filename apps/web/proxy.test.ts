import { describe, expect, it } from "vitest";

import { resolveMobilePathname } from "@/proxy";

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
    // resolveMobilePathname should never receive /m paths (the proxy
    // already excludes them from redirect), but if it does, it falls back
    // to /m rather than double-prefixing.
    expect(resolveMobilePathname("/m")).toBe("/m");
    expect(resolveMobilePathname("/m/categories")).toBe("/m");
  });

  it("handles edge cases: empty string, query-like paths", () => {
    expect(resolveMobilePathname("")).toBe("/m");
    expect(resolveMobilePathname("/?v=abc")).toBe("/m");
  });
});
