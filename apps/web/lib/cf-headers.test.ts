import { NextRequest } from "next/server";

import { extractClientIp, hashClientIp } from "@/lib/cf-headers";

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/", { headers });
}

describe("extractClientIp", () => {
  it("prefers CF-Connecting-IP over proxy-added headers", () => {
    const req = makeRequest({
      "CF-Connecting-IP": "203.0.113.7",
      "X-Real-IP": "10.0.0.1",
      "X-Forwarded-For": "198.51.100.2, 10.0.0.1",
    });
    expect(extractClientIp(req)).toBe("203.0.113.7");
  });

  it("falls back to X-Real-IP when CF header is absent", () => {
    const req = makeRequest({ "X-Real-IP": "10.0.0.1" });
    expect(extractClientIp(req)).toBe("10.0.0.1");
  });

  it("falls back to the first X-Forwarded-For hop", () => {
    const req = makeRequest({ "X-Forwarded-For": "198.51.100.2, 10.0.0.1" });
    expect(extractClientIp(req)).toBe("198.51.100.2");
  });

  it("takes only the first CF-Connecting-IP when multiple are present", () => {
    const req = makeRequest({ "CF-Connecting-IP": "203.0.113.7, 203.0.113.8" });
    expect(extractClientIp(req)).toBe("203.0.113.7");
  });

  it("returns null when no IP headers are present", () => {
    expect(extractClientIp(makeRequest())).toBeNull();
  });
});

describe("hashClientIp", () => {
  it("produces a stable 64-char hex digest", () => {
    const hash = hashClientIp("203.0.113.7");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashClientIp("203.0.113.7"));
  });

  it("differs across IPs", () => {
    expect(hashClientIp("203.0.113.7")).not.toBe(hashClientIp("203.0.113.8"));
  });
});
