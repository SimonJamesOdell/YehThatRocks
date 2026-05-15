import { describe, expect, it } from "vitest";

import {
  getCacheEntry,
  pruneCacheToMaxEntries,
  pruneExpiringCacheEntries,
  readPositiveIntEnv,
  setCacheEntry,
} from "@/lib/server-auth-cache";

describe("server auth cache helpers", () => {
  it("stores and retrieves unexpired entries", () => {
    const entries = new Map<string, { value: string; expiresAt: number }>();

    setCacheEntry(entries, "token-a", "auth-state", 5_000, 100, 100_000);
    const cached = getCacheEntry(entries, "token-a", 100_100);

    expect(cached).toBe("auth-state");
  });

  it("drops expired entries on read", () => {
    const entries = new Map<string, { value: string; expiresAt: number }>();

    setCacheEntry(entries, "token-a", "auth-state", 500, 100, 100_000);
    const cached = getCacheEntry(entries, "token-a", 100_600);

    expect(cached).toBeUndefined();
    expect(entries.size).toBe(0);
  });

  it("prunes oldest entries to max size", () => {
    const entries = new Map<string, { value: string; expiresAt: number }>();

    setCacheEntry(entries, "a", "A", 5_000, 10, 100_000);
    setCacheEntry(entries, "b", "B", 5_000, 10, 100_000);
    setCacheEntry(entries, "c", "C", 5_000, 10, 100_000);
    pruneCacheToMaxEntries(entries, 2);

    expect(entries.has("a")).toBe(false);
    expect(entries.has("b")).toBe(true);
    expect(entries.has("c")).toBe(true);
  });

  it("prunes expired entries in bulk", () => {
    const entries = new Map<string, { value: string; expiresAt: number }>();

    entries.set("a", { value: "A", expiresAt: 100 });
    entries.set("b", { value: "B", expiresAt: 200 });
    entries.set("c", { value: "C", expiresAt: 300 });

    pruneExpiringCacheEntries(entries, 200);

    expect(entries.has("a")).toBe(false);
    expect(entries.has("b")).toBe(false);
    expect(entries.has("c")).toBe(true);
  });

  it("reads bounded integer env values safely", () => {
    process.env.SERVER_AUTH_CACHE_TTL_MS = "999999";
    const high = readPositiveIntEnv("SERVER_AUTH_CACHE_TTL_MS", 5_000, 500, 30_000);
    expect(high).toBe(30_000);

    process.env.SERVER_AUTH_CACHE_TTL_MS = "-42";
    const low = readPositiveIntEnv("SERVER_AUTH_CACHE_TTL_MS", 5_000, 500, 30_000);
    expect(low).toBe(500);

    process.env.SERVER_AUTH_CACHE_TTL_MS = "not-a-number";
    const fallback = readPositiveIntEnv("SERVER_AUTH_CACHE_TTL_MS", 5_000, 500, 30_000);
    expect(fallback).toBe(5_000);

    delete process.env.SERVER_AUTH_CACHE_TTL_MS;
  });
});
