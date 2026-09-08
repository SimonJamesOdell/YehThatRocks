import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";

import { computeAccountTier, resolveTrustTier } from "@/lib/trust-tier";
import { flagIp, recordBenignActivity } from "@/lib/trust-reputation";

const DEV_SECRET = "ytr-botok-dev-secret";

function signBotok(nonce: string, issuedAt: number, secret = DEV_SECRET): string {
  const payload = `${nonce}:${issuedAt}`;
  const sig = createHmac("sha256", secret).update(`ytr-botok:${payload}`).digest("hex");
  return `${payload}:${sig}`;
}

function requestWith(ip: string, cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/auth/register", {
    headers: {
      "x-forwarded-for": ip,
      ...(cookie ? { cookie } : {}),
    },
  });
}

describe("computeAccountTier", () => {
  it("returns tier 3 for a verified-email account", () => {
    expect(computeAccountTier({ emailVerifiedAt: new Date(), createdAt: new Date(), isAnonymous: false })).toBe(3);
  });

  it("returns tier 3 for an old unverified account", () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    expect(computeAccountTier({ emailVerifiedAt: null, createdAt: old, isAnonymous: false })).toBe(3);
  });

  it("returns tier 2 for a fresh unverified account", () => {
    expect(computeAccountTier({ emailVerifiedAt: null, createdAt: new Date(), isAnonymous: false })).toBe(2);
  });

  it("returns tier 2 for anonymous accounts even when old", () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    expect(computeAccountTier({ emailVerifiedAt: null, createdAt: old, isAnonymous: true })).toBe(2);
  });

  it("returns tier 2 for missing signals", () => {
    expect(computeAccountTier(null)).toBe(2);
    expect(computeAccountTier(undefined)).toBe(2);
  });
});

describe("resolveTrustTier", () => {
  it("returns tier 1 for a cold anonymous client", () => {
    const req = requestWith("203.0.113.20");
    expect(resolveTrustTier(req, null, null)).toEqual({ tier: 1, reason: "cold" });
  });

  it("returns tier 2 for a valid proof-of-work cookie", () => {
    const now = Math.floor(Date.now() / 1000);
    const req = requestWith("203.0.113.21", `ytr_botok=${signBotok("deadbeef0001", now)}`);
    expect(resolveTrustTier(req, null, null)).toEqual({ tier: 2, reason: "proof-of-work" });
  });

  it("returns tier 3 for an authenticated, verified account", () => {
    const req = requestWith("203.0.113.22");
    const auth = { userId: 7, email: "human@example.com", isGuest: false };
    const account = { emailVerifiedAt: new Date(), createdAt: new Date(), isAnonymous: false };
    expect(resolveTrustTier(req, auth, account)).toEqual({ tier: 3, reason: "trusted-account" });
  });

  it("returns tier 2 for an authenticated but fresh account", () => {
    const req = requestWith("203.0.113.23");
    const auth = { userId: 8, email: "new@example.com", isGuest: false };
    const account = { emailVerifiedAt: null, createdAt: new Date(), isAnonymous: false };
    expect(resolveTrustTier(req, auth, account)).toEqual({ tier: 2, reason: "authenticated" });
  });

  it("returns tier 0 for a flagged IP", () => {
    const req = requestWith("203.0.113.24");
    flagIp(req, "test-flag");
    expect(resolveTrustTier(req, null, null)).toEqual({ tier: 0, reason: "flagged" });
  });

  it("returns tier 2 for a warm IP", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T10:00:00Z"));

    const req = requestWith("203.0.113.25");
    recordBenignActivity(req);

    vi.setSystemTime(new Date("2026-09-06T10:00:40Z"));
    recordBenignActivity(req);

    vi.setSystemTime(new Date("2026-09-06T10:03:00Z"));
    expect(resolveTrustTier(req, null, null)).toEqual({ tier: 2, reason: "warm-activity" });

    vi.useRealTimers();
  });
});
