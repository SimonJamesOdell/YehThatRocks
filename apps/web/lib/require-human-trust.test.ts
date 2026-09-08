import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";

import { requireHumanTrustOrResponse, TRUST_REQUIRED_CODE } from "@/lib/require-human-trust";

const DEV_SECRET = "ytr-botok-dev-secret";

function signBotok(nonce: string, issuedAt: number): string {
  const payload = `${nonce}:${issuedAt}`;
  const sig = createHmac("sha256", DEV_SECRET).update(`ytr-botok:${payload}`).digest("hex");
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

describe("requireHumanTrustOrResponse", () => {
  it("returns a 403 TRUST_REQUIRED response for a cold client", async () => {
    const res = requireHumanTrustOrResponse(requestWith("203.0.113.30"), null, {});
    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);

    const body = await res?.json();
    expect(body.code).toBe(TRUST_REQUIRED_CODE);
  });

  it("returns null for a proof-of-work cookie holder", () => {
    const now = Math.floor(Date.now() / 1000);
    const res = requireHumanTrustOrResponse(
      requestWith("203.0.113.31", `ytr_botok=${signBotok("cafebabe0002", now)}`),
      null,
      {},
    );
    expect(res).toBeNull();
  });

  it("returns null for a loopback client (local dev / smoke test)", () => {
    const res = requireHumanTrustOrResponse(requestWith("127.0.0.1"), null, {});
    expect(res).toBeNull();
  });

  it("returns null for an authenticated account", () => {
    const res = requireHumanTrustOrResponse(
      requestWith("203.0.113.32"),
      { userId: 9, email: "human@example.com", isGuest: false },
      {},
    );
    expect(res).toBeNull();
  });

  it("returns null for a verified account when minimumTier is 3", () => {
    const res = requireHumanTrustOrResponse(
      requestWith("203.0.113.33"),
      { userId: 10, email: "human@example.com", isGuest: false },
      { minimumTier: 3, account: { emailVerifiedAt: new Date(), createdAt: new Date(), isAnonymous: false } },
    );
    expect(res).toBeNull();
  });

  it("returns a 403 when minimumTier is 3 but the account is fresh", () => {
    const res = requireHumanTrustOrResponse(
      requestWith("203.0.113.34"),
      { userId: 11, email: "new@example.com", isGuest: false },
      { minimumTier: 3, account: { emailVerifiedAt: null, createdAt: new Date(), isAnonymous: false } },
    );
    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
  });
});
