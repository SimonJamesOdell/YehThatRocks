import { describe, expect, it, vi } from "vitest";

import {
  weightedRandomSelect,
  RECENT_DECAY_BASE,
  RECENT_DECAY_MAX,
  WEIGHTED_POOL_SIZE,
} from "@/lib/weighted-random-select";
import type { RankedVideoRow } from "@/lib/catalog-data-utils";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeVideo(
  overrides: Partial<RankedVideoRow> & { videoId: string },
): RankedVideoRow {
  return {
    videoId: overrides.videoId,
    title: overrides.title ?? `Track ${overrides.videoId}`,
    channelTitle: overrides.channelTitle ?? null,
    favourited: overrides.favourited ?? 0,
    viewCount: overrides.viewCount ?? 0,
    description: overrides.description ?? null,
  };
}

function makePool(n: number): RankedVideoRow[] {
  return Array.from({ length: n }, (_, i) =>
    makeVideo({
      videoId: `video-${String(i).padStart(2, "0")}`,
      favourited: 0,
      viewCount: 0,
    }),
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("weightedRandomSelect", () => {
  // ── Boundary conditions ────────────────────────────────────────────────────

  it("returns -1 for an empty pool", () => {
    expect(weightedRandomSelect([], [])).toBe(-1);
  });

  it("returns index 0 for a single-element pool (only option)", () => {
    const pool = [makeVideo({ videoId: "aaa" })];
    expect(weightedRandomSelect(pool, [])).toBe(0);
  });

  // ── Basic uniform selection (equal weights) ────────────────────────────────

  it("selects each video in a uniform pool roughly equally", () => {
    const pool = makePool(100);
    const counts = new Array(100).fill(0);

    // 10,000 trials is enough for stable distribution testing
    for (let i = 0; i < 10_000; i++) {
      const idx = weightedRandomSelect(pool, []);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(pool.length);
      counts[idx]++;
    }

    // With 10,000 trials and 100 equally-weighted videos, each should appear
    // ~100 times. Large deviation would indicate a bug.
    const expected = 10_000 / 100;
    for (let i = 0; i < 100; i++) {
      // Allow ±50% tolerance — statistical, not a hard boundary
      expect(counts[i]).toBeGreaterThan(expected * 0.5);
      expect(counts[i]).toBeLessThan(expected * 1.5);
    }
  });

  // ── Engagement weighting ───────────────────────────────────────────────────

  it("gives higher weight to high-favourited videos", () => {
    const highFav = makeVideo({ videoId: "high", favourited: 100, viewCount: 0 });
    const lowFav = makeVideo({ videoId: "low", favourited: 0, viewCount: 0 });
    const pool = [highFav, lowFav];

    // Calculate expected weight ratio:
    // highFav: (1 + ln(101)) * (1 + ln(1)) = (1 + 4.615) * 1 = 5.615
    // lowFav:  (1 + ln(1))   * (1 + ln(1)) = 1 * 1 = 1
    // So highFav should be picked ~5.6/6.6 ≈ 85% of the time
    const highWeight = (1 + Math.log(1 + 100)) * (1 + Math.log(1 + 0));
    const lowWeight = (1 + Math.log(1 + 0)) * (1 + Math.log(1 + 0));
    const expectedHighRatio = highWeight / (highWeight + lowWeight);

    let highCount = 0;
    const trials = 5_000;
    for (let i = 0; i < trials; i++) {
      if (weightedRandomSelect(pool, []) === 0) highCount++;
    }

    const actualRatio = highCount / trials;
    // Allow ±15% absolute tolerance around the expected ratio
    expect(actualRatio).toBeGreaterThan(expectedHighRatio - 0.15);
    expect(actualRatio).toBeLessThan(expectedHighRatio + 0.15);
  });

  it("gives higher weight to high-viewCount videos", () => {
    const highViews = makeVideo({ videoId: "high-v", favourited: 0, viewCount: 10_000 });
    const lowViews = makeVideo({ videoId: "low-v", favourited: 0, viewCount: 0 });
    const pool = [highViews, lowViews];

    const highWeight = (1 + Math.log(1 + 0)) * (1 + Math.log(1 + 10_000));
    const lowWeight = (1 + Math.log(1 + 0)) * (1 + Math.log(1 + 0));
    const expectedHighRatio = highWeight / (highWeight + lowWeight);

    let highCount = 0;
    const trials = 5_000;
    for (let i = 0; i < trials; i++) {
      if (weightedRandomSelect(pool, []) === 0) highCount++;
    }

    const actualRatio = highCount / trials;
    expect(actualRatio).toBeGreaterThan(expectedHighRatio - 0.15);
    expect(actualRatio).toBeLessThan(expectedHighRatio + 0.15);
  });

  // ── Recency decay ──────────────────────────────────────────────────────────

  it("penalises a single recently-played video", () => {
    // Two identical videos; video-00 is "recently played"
    const pool = makePool(2);
    pool[0] = { ...pool[0], videoId: "recent" };
    pool[1] = { ...pool[1], videoId: "other" };

    const recentIds = ["recent"];

    // recent weight = baseWeight * RECENT_DECAY_BASE = 1 * 0.1 = 0.1
    // other weight = baseWeight = 1
    // expected ratio for other: 1 / 1.1 ≈ 90.9%
    const otherWeight = 1;
    const recentWeight = 1 * RECENT_DECAY_BASE;
    const expectedOtherRatio = otherWeight / (otherWeight + recentWeight);

    let otherCount = 0;
    const trials = 5_000;
    for (let i = 0; i < trials; i++) {
      if (weightedRandomSelect(pool, recentIds) === 1) otherCount++;
    }

    const actualRatio = otherCount / trials;
    expect(actualRatio).toBeGreaterThan(expectedOtherRatio - 0.15);
    expect(actualRatio).toBeLessThan(expectedOtherRatio + 0.15);
  });

  it("applies progressive decay — older recent = less penalty", () => {
    // Three identical videos, all in the recent list with different recency
    const pool = [
      makeVideo({ videoId: "most-recent" }),
      makeVideo({ videoId: "middle" }),
      makeVideo({ videoId: "least-recent" }),
    ];

    // most-recent: weight * RECENT_DECAY_BASE = 1 * 0.1 = 0.1
    // middle:      weight * 0.1 + 0.8*(1/2) = 1 * 0.5 = 0.5
    // least-recent: weight * 0.1 + 0.8*(2/2) = 1 * 0.9 = 0.9
    const recentIds = ["most-recent", "middle", "least-recent"];

    const w0 = 1 * RECENT_DECAY_BASE;                                                    // 0.1
    const w1 = 1 * (RECENT_DECAY_BASE + (RECENT_DECAY_MAX - RECENT_DECAY_BASE) * (1 / 2)); // 0.5
    const w2 = 1 * (RECENT_DECAY_BASE + (RECENT_DECAY_MAX - RECENT_DECAY_BASE) * (2 / 2)); // 0.9
    const totalW = w0 + w1 + w2;                                                        // 1.5

    const counts = [0, 0, 0];
    const trials = 10_000;
    for (let i = 0; i < trials; i++) {
      const idx = weightedRandomSelect(pool, recentIds);
      counts[idx]++;
    }

    // least-recent (idx 2) should be picked most often, most-recent (idx 0) least
    expect(counts[2]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[0]);

    // Verify ratios are within tolerance
    expect(counts[0] / trials).toBeGreaterThan(w0 / totalW - 0.1);
    expect(counts[0] / trials).toBeLessThan(w0 / totalW + 0.1);
    expect(counts[2] / trials).toBeGreaterThan(w2 / totalW - 0.1);
    expect(counts[2] / trials).toBeLessThan(w2 / totalW + 0.1);
  });

  it("does not penalise videos not in the recent list", () => {
    const pool = makePool(50);
    const recentIds = ["completely-different-id", "another-different-id"];

    // All videos should have equal weight — the recent IDs don't match anything
    const counts = new Array(50).fill(0);
    const trials = 5_000;
    for (let i = 0; i < trials; i++) {
      const idx = weightedRandomSelect(pool, recentIds);
      counts[idx]++;
    }

    const expected = trials / 50;
    for (let i = 0; i < 50; i++) {
      expect(counts[i]).toBeGreaterThan(expected * 0.5);
      expect(counts[i]).toBeLessThan(expected * 1.5);
    }
  });

  // ── Edge cases ──────────────────────────────────────────────────────────────

  it("handles recentVideoIds array longer than the pool", () => {
    const pool = [makeVideo({ videoId: "a" }), makeVideo({ videoId: "b" })];
    const recentIds = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

    // Should not throw; a (idx 0) is most recent, b (idx 1) is second
    let bCount = 0;
    const trials = 2_000;
    for (let i = 0; i < trials; i++) {
      if (weightedRandomSelect(pool, recentIds) === 1) bCount++;
    }

    // b should be picked more often (it's less recently played)
    expect(bCount).toBeGreaterThan(trials * 0.55);
  });

  it("handles duplicate entries in recentVideoIds gracefully", () => {
    const pool = makePool(2);
    pool[0] = { ...pool[0], videoId: "dup" };
    pool[1] = { ...pool[1], videoId: "other" };

    // recency map uses forEach, so last occurrence wins for position
    const recentIds = ["dup", "dup"]; // position = 1

    // dup weight = 1 * (0.1 + 0.8*1) = 0.9
    // other weight = 1
    const dupWeight = 1 * (RECENT_DECAY_BASE + (RECENT_DECAY_MAX - RECENT_DECAY_BASE) * 1);
    const otherWeight = 1;

    let otherCount = 0;
    const trials = 2_000;
    for (let i = 0; i < trials; i++) {
      if (weightedRandomSelect(pool, recentIds) === 1) otherCount++;
    }

    const expectedOtherRatio = otherWeight / (otherWeight + dupWeight);
    expect(otherCount / trials).toBeGreaterThan(expectedOtherRatio - 0.15);
    expect(otherCount / trials).toBeLessThan(expectedOtherRatio + 0.15);
  });

  it("handles undefined viewCount and favourited as 0", () => {
    const pool: RankedVideoRow[] = [
      {
        videoId: "a",
        title: "A",
        channelTitle: null,
        favourited: undefined as unknown as number,
        viewCount: undefined as unknown as number,
        description: null,
      },
      {
        videoId: "b",
        title: "B",
        channelTitle: null,
        favourited: undefined as unknown as number,
        viewCount: undefined as unknown as number,
        description: null,
      },
    ];

    // Both should have equal weight (1)
    const counts = [0, 0];
    const trials = 2_000;
    for (let i = 0; i < trials; i++) {
      const idx = weightedRandomSelect(pool, []);
      counts[idx]++;
    }

    expect(counts[0]).toBeGreaterThan(trials * 0.4);
    expect(counts[1]).toBeGreaterThan(trials * 0.4);
  });

  it("returns last index when floating-point edge case skips the last bucket", () => {
    // With two identical-weight videos, Math.random() near 1.0 might land
    // just past the last bucket due to floating point. The fallback at
    // the end of the function catches this.
    const pool = makePool(2);
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.9999999999999999);

    const result = weightedRandomSelect(pool, []);
    expect(result).toBe(1); // should return last index

    spy.mockRestore();
  });

  // ── Deterministic with controlled Math.random ──────────────────────────────

  it("returns first video when Math.random is 0", () => {
    const pool = makePool(100);
    const spy = vi.spyOn(Math, "random").mockReturnValue(0);

    const result = weightedRandomSelect(pool, []);
    expect(result).toBe(0);

    spy.mockRestore();
  });

  it("returns the correct index for a known random value", () => {
    const pool: RankedVideoRow[] = [
      makeVideo({ videoId: "a", favourited: 0, viewCount: 0 }),  // weight 1
      makeVideo({ videoId: "b", favourited: 0, viewCount: 0 }),  // weight 1
      makeVideo({ videoId: "c", favourited: 0, viewCount: 0 }),  // weight 1
    ];
    // Weights: [1, 1, 1]; cumulative: [1, 2, 3]
    // random=0.5 → random*3=1.5 → falls in bucket 1 (index 1)
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);

    const result = weightedRandomSelect(pool, []);
    expect(result).toBe(1);

    spy.mockRestore();
  });

  // ── WEIGHTED_POOL_SIZE constant ─────────────────────────────────────────────

  it("WEIGHTED_POOL_SIZE is 200", () => {
    expect(WEIGHTED_POOL_SIZE).toBe(200);
  });

  // ── RECENT_DECAY constants ─────────────────────────────────────────────────

  it("RECENT_DECAY_BASE is 0.1 and RECENT_DECAY_MAX is 0.9", () => {
    expect(RECENT_DECAY_BASE).toBe(0.1);
    expect(RECENT_DECAY_MAX).toBe(0.9);
  });
});
