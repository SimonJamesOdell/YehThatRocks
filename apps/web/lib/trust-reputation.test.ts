import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  flagIp,
  isFlagged,
  isWarm,
  recordBenignActivity,
  recordDenied,
  recordPowSolved,
} from "@/lib/trust-reputation";

function requestWith(ip: string): NextRequest {
  return new NextRequest("http://localhost/api/videos/top", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("trust-reputation in-memory signals", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks an IP warm after lingering across a meaningful span", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T10:00:00Z"));

    const req = requestWith("203.0.113.40");
    recordBenignActivity(req);

    vi.setSystemTime(new Date("2026-09-06T10:00:40Z"));
    recordBenignActivity(req);

    vi.setSystemTime(new Date("2026-09-06T10:03:00Z"));
    expect(isWarm(req)).toBe(true);
  });

  it("does not mark a same-instant burst as warm", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T10:00:00Z"));

    const req = requestWith("203.0.113.41");
    recordBenignActivity(req);
    recordBenignActivity(req);
    recordBenignActivity(req);

    expect(isWarm(req)).toBe(false);
  });

  it("tracks flags independently of warm state", () => {
    const req = requestWith("203.0.113.42");
    expect(isFlagged(req)).toBe(false);

    flagIp(req, "persistent-denials");
    expect(isFlagged(req)).toBe(true);
  });

  it("records denials and solves without a database present", () => {
    const req = requestWith("203.0.113.43");
    recordDenied(req);
    recordPowSolved(req);
    expect(isFlagged(req)).toBe(false);
  });
});
