import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The reputation layer fires fire-and-forget DB reads; stub it out so the route
// gate can be exercised without a database.
vi.mock("@/lib/trust-reputation", () => ({
  REPUTATION_RETENTION_DAYS: 180,
  isFlagged: () => false,
  isWarm: () => false,
  recordBenignActivity: () => {},
  recordPowSolved: () => {},
  recordDenied: () => {},
  flagIp: () => {},
  hydrateReputation: () => {},
  flushReputationWrites: async () => {},
  pruneExpiredReputation: async () => 0,
}));

beforeAll(() => {
  // The account-creation routes short-circuit with a 503 when DATABASE_URL is
  // unset; give it a dummy so the request reaches the trust gate. No real query
  // runs because the gate rejects before the user create.
  process.env.DATABASE_URL = "mysql://test:test@127.0.0.1:3307/yeh";
});

describe("account-creation trust gate (cold client)", () => {
  it("register rejects a cold client with 403 TRUST_REQUIRED", async () => {
    const { POST } = await import("@/app/api/auth/register/route");

    const request = new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0",
        origin: "http://localhost",
        "x-forwarded-for": "203.0.113.50",
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("TRUST_REQUIRED");
  });

  it("anonymous rejects a cold client with 403 TRUST_REQUIRED", async () => {
    const { POST } = await import("@/app/api/auth/anonymous/route");

    const request = new NextRequest("http://localhost/api/auth/anonymous", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0",
        origin: "http://localhost",
        "sec-fetch-site": "same-origin",
        "x-forwarded-for": "203.0.113.51",
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("TRUST_REQUIRED");
  });
});
