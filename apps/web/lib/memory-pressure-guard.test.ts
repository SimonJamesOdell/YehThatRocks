import { describe, expect, it } from "vitest";

import {
  buildMemorySnapshot,
  isMemoryPressureHigh,
  shouldRunMemoryRelief,
} from "@/lib/memory-pressure-guard";

describe("memory pressure guard heuristics", () => {
  it("flags pressure when heap usage ratio crosses threshold", () => {
    const snapshot = {
      heapUsedBytes: 80,
      heapTotalBytes: 100,
      rssBytes: 120 * 1024 * 1024,
    };

    const pressure = isMemoryPressureHigh(snapshot, {
      heapUsedRatioThreshold: 0.74,
      rssMbThreshold: 500,
    });

    expect(pressure).toBe(true);
  });

  it("flags pressure when rss crosses threshold even if heap ratio is low", () => {
    const snapshot = {
      heapUsedBytes: 30,
      heapTotalBytes: 100,
      rssBytes: 250 * 1024 * 1024,
    };

    const pressure = isMemoryPressureHigh(snapshot, {
      heapUsedRatioThreshold: 0.9,
      rssMbThreshold: 200,
    });

    expect(pressure).toBe(true);
  });

  it("respects cooldown after a recent relief", () => {
    const snapshot = {
      heapUsedBytes: 90,
      heapTotalBytes: 100,
      rssBytes: 300 * 1024 * 1024,
    };

    const shouldRun = shouldRunMemoryRelief(
      snapshot,
      10_000,
      { lastReliefAtMs: 9_500 },
      {
        checkIntervalMs: 10_000,
        cooldownMs: 1_000,
        thresholds: {
          heapUsedRatioThreshold: 0.7,
          rssMbThreshold: 200,
        },
      },
    );

    expect(shouldRun).toBe(false);
  });

  it("allows relief after cooldown has elapsed", () => {
    const snapshot = {
      heapUsedBytes: 90,
      heapTotalBytes: 100,
      rssBytes: 300 * 1024 * 1024,
    };

    const shouldRun = shouldRunMemoryRelief(
      snapshot,
      10_000,
      { lastReliefAtMs: 8_000 },
      {
        checkIntervalMs: 10_000,
        cooldownMs: 1_000,
        thresholds: {
          heapUsedRatioThreshold: 0.7,
          rssMbThreshold: 200,
        },
      },
    );

    expect(shouldRun).toBe(true);
  });

  it("builds a safe snapshot from process memory usage", () => {
    const snapshot = buildMemorySnapshot({
      rss: 200,
      heapTotal: 0,
      heapUsed: 50,
      external: 0,
      arrayBuffers: 0,
    });

    expect(snapshot.heapUsedBytes).toBe(50);
    expect(snapshot.heapTotalBytes).toBe(1);
    expect(snapshot.rssBytes).toBe(200);
  });
});
