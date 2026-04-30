import { describe, expect, it, vi } from "vitest";

import { createSeenVideoIdCache } from "@/lib/seen-video-id-cache";

describe("seen video id cache", () => {
  it("returns a cloned set on get", () => {
    const cache = createSeenVideoIdCache(1_000);
    cache.set(42, new Set(["v1", "v2"]));

    const first = cache.get(42);
    expect(first).toBeDefined();
    expect(first?.has("v1")).toBe(true);

    first?.add("mutated");

    const second = cache.get(42);
    expect(second?.has("mutated")).toBe(false);
  });

  it("expires entries after ttl", () => {
    vi.useFakeTimers();
    const cache = createSeenVideoIdCache(100);

    cache.set(7, new Set(["v1"]));
    expect(cache.get(7)?.has("v1")).toBe(true);

    vi.advanceTimersByTime(101);
    expect(cache.get(7)).toBeUndefined();

    vi.useRealTimers();
  });

  it("adds video id into a live cached set", () => {
    const cache = createSeenVideoIdCache(1_000);
    cache.set(9, new Set(["old"]));

    cache.add(9, "new");

    const ids = cache.get(9);
    expect(ids?.has("old")).toBe(true);
    expect(ids?.has("new")).toBe(true);
  });

  it("does not resurrect expired entries through add", () => {
    vi.useFakeTimers();
    const cache = createSeenVideoIdCache(100);

    cache.set(5, new Set(["v1"]));
    vi.advanceTimersByTime(101);

    cache.add(5, "v2");
    expect(cache.get(5)).toBeUndefined();

    vi.useRealTimers();
  });

  it("evicts the oldest entry when max entries is exceeded", () => {
    const cache = createSeenVideoIdCache(1_000, { maxEntries: 2 });

    cache.set(1, new Set(["a"]));
    cache.set(2, new Set(["b"]));
    cache.set(3, new Set(["c"]));

    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)?.has("b")).toBe(true);
    expect(cache.get(3)?.has("c")).toBe(true);
  });
});
