import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";

import { assessHumanTrust, noteBenignActivity, verifyBotOkCookie } from "@/lib/trust";

const DEV_SECRET = "ytr-botok-dev-secret";

function signBotok(nonce: string, issuedAt: number, secret = DEV_SECRET): string {
  const payload = `${nonce}:${issuedAt}`;
  const sig = createHmac("sha256", secret).update(`ytr-botok:${payload}`).digest("hex");
  return `${payload}:${sig}`;
}

function requestWith(ip: string, cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/videos/unavailable", {
    headers: {
      "x-forwarded-for": ip,
      ...(cookie ? { cookie } : {}),
    },
  });
}

describe("verifyBotOkCookie", () => {
  it("accepts a freshly signed cookie", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyBotOkCookie(signBotok("abcdef123456", now))).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyBotOkCookie(signBotok("abcdef123456", now) + "00")).toBe(false);
  });

  it("rejects an expired cookie", () => {
    const expired = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
    expect(verifyBotOkCookie(signBotok("abcdef123456", expired))).toBe(false);
  });

  it("rejects malformed and missing values", () => {
    expect(verifyBotOkCookie(undefined)).toBe(false);
    expect(verifyBotOkCookie("")).toBe(false);
    expect(verifyBotOkCookie("abc")).toBe(false);
  });
});

describe("assessHumanTrust", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("trusts an authenticated user immediately", () => {
    const req = requestWith("203.0.113.9");
    expect(assessHumanTrust(req, { userId: 7, email: "human@example.com", isGuest: false }))
      .toEqual({ trusted: true, reason: "authenticated" });
  });

  it("trusts a valid proof-of-work cookie", () => {
    const now = Math.floor(Date.now() / 1000);
    const req = requestWith("203.0.113.10", `ytr_botok=${signBotok("beef0000cafe", now)}`);
    expect(assessHumanTrust(req, null)).toEqual({ trusted: true, reason: "proof-of-work" });
  });

  it("denies a cold, anonymous client with no proof", () => {
    const req = requestWith("203.0.113.11");
    expect(assessHumanTrust(req, null)).toEqual({ trusted: false, reason: "insufficient" });
  });

  it("trusts an IP that has browsed across a meaningful time span", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T10:00:00Z"));

    const req = requestWith("203.0.113.12");
    noteBenignActivity(req);

    vi.setSystemTime(new Date("2026-09-06T10:00:40Z"));
    noteBenignActivity(req);

    vi.setSystemTime(new Date("2026-09-06T10:03:00Z"));
    expect(assessHumanTrust(req, null)).toEqual({ trusted: true, reason: "warm-activity" });
  });

  it("does not trust a burst of requests that never lingers", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T10:00:00Z"));

    const req = requestWith("203.0.113.13");
    noteBenignActivity(req);
    noteBenignActivity(req);
    noteBenignActivity(req);

    // Same instant — a one-shot burst, not sustained presence.
    expect(assessHumanTrust(req, null)).toEqual({ trusted: false, reason: "insufficient" });
  });
});
