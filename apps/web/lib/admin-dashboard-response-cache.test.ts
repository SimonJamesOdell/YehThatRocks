import { afterEach, describe, expect, it } from "vitest";

import {
  clearDashboardResponseCacheForTests,
  getCachedDashboardResponsePayload,
  getDashboardResponseInFlight,
  readDashboardResponseCacheTtlMs,
  setCachedDashboardResponsePayload,
  setDashboardResponseInFlight,
} from "@/lib/admin-dashboard-response-cache";

describe("admin dashboard response cache", () => {
  afterEach(() => {
    clearDashboardResponseCacheForTests();
  });

  it("returns cached payload while TTL is active", () => {
    const payload = { ok: true, counts: { users: 1 } };
    setCachedDashboardResponsePayload(payload, { now: 1_000, ttlMs: 500 });

    expect(getCachedDashboardResponsePayload(1_499)).toEqual(payload);
  });

  it("expires payload when TTL elapses", () => {
    setCachedDashboardResponsePayload({ ok: true }, { now: 10_000, ttlMs: 100 });

    expect(getCachedDashboardResponsePayload(10_100)).toBeNull();
    expect(getCachedDashboardResponsePayload(10_101)).toBeNull();
  });

  it("tracks in-flight payload work", async () => {
    const promise = Promise.resolve({ ok: true, meta: { generatedAt: "now" } });
    setDashboardResponseInFlight(promise);

    expect(getDashboardResponseInFlight()).toBe(promise);
    await expect(getDashboardResponseInFlight()).resolves.toEqual({ ok: true, meta: { generatedAt: "now" } });

    setDashboardResponseInFlight(null);
    expect(getDashboardResponseInFlight()).toBeNull();
  });

  it("reads and clamps configured TTL", () => {
    expect(readDashboardResponseCacheTtlMs({ ADMIN_DASHBOARD_RESPONSE_CACHE_TTL_MS: "10" } as NodeJS.ProcessEnv)).toBe(250);
    expect(readDashboardResponseCacheTtlMs({ ADMIN_DASHBOARD_RESPONSE_CACHE_TTL_MS: "750" } as NodeJS.ProcessEnv)).toBe(750);
    expect(readDashboardResponseCacheTtlMs({ ADMIN_DASHBOARD_RESPONSE_CACHE_TTL_MS: "60000" } as NodeJS.ProcessEnv)).toBe(10_000);
    expect(readDashboardResponseCacheTtlMs({ ADMIN_DASHBOARD_RESPONSE_CACHE_TTL_MS: "bad" } as NodeJS.ProcessEnv)).toBe(1_000);
  });
});
