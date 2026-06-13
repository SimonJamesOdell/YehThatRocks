import { afterEach, describe, expect, it, vi } from "vitest";

const clearCurrentVideoRouteCachesMock = vi.fn();
const clearVideosCachesMock = vi.fn();
const clearArtistCachesMock = vi.fn();
const clearGenreCachesMock = vi.fn();
const clearHistoryCachesMock = vi.fn();
const clearFavouritesCachesMock = vi.fn();
const resetRuntimeProfilingMock = vi.fn();

vi.mock("@/lib/current-video-cache", () => ({
  clearCurrentVideoRouteCaches: clearCurrentVideoRouteCachesMock,
}));

vi.mock("@/lib/catalog-data-videos", () => ({
  clearVideosCaches: clearVideosCachesMock,
}));

vi.mock("@/lib/catalog-data-artists", () => ({
  clearArtistCaches: clearArtistCachesMock,
}));

vi.mock("@/lib/catalog-data-genres", () => ({
  clearGenreCaches: clearGenreCachesMock,
}));

vi.mock("@/lib/catalog-data-history", () => ({
  clearHistoryCaches: clearHistoryCachesMock,
}));

vi.mock("@/lib/catalog-data-favourites", () => ({
  clearFavouritesCaches: clearFavouritesCachesMock,
}));

vi.mock("@/lib/runtime-profiler", () => ({
  resetRuntimeProfiling: resetRuntimeProfilingMock,
}));

import {
  buildMemorySnapshot,
  isMemoryPressureHigh,
  resetMemoryPressureGuardStateForTests,
  runMemoryPressureGuardTick,
  shouldRunMemoryRelief,
} from "@/lib/memory-pressure-guard";

afterEach(() => {
  resetMemoryPressureGuardStateForTests();
  vi.restoreAllMocks();
  clearCurrentVideoRouteCachesMock.mockReset();
  clearVideosCachesMock.mockReset();
  clearArtistCachesMock.mockReset();
  clearGenreCachesMock.mockReset();
  clearHistoryCachesMock.mockReset();
  clearFavouritesCachesMock.mockReset();
  resetRuntimeProfilingMock.mockReset();
});

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

  it("runs relief under pressure and clears genre caches", async () => {
    const memoryUsageSpy = vi.spyOn(process, "memoryUsage").mockReturnValue({
      rss: 300 * 1024 * 1024,
      heapTotal: 100,
      heapUsed: 90,
      external: 0,
      arrayBuffers: 0,
    });

    const relieved = await runMemoryPressureGuardTick(50_000, {
      checkIntervalMs: 10_000,
      cooldownMs: 1_000,
      thresholds: {
        heapUsedRatioThreshold: 0.7,
        rssMbThreshold: 200,
      },
    });

    expect(relieved).toBe(true);
    expect(memoryUsageSpy).toHaveBeenCalled();
    expect(clearCurrentVideoRouteCachesMock).toHaveBeenCalledTimes(1);
    expect(clearVideosCachesMock).not.toHaveBeenCalled();
    expect(clearArtistCachesMock).toHaveBeenCalledTimes(1);
    expect(clearGenreCachesMock).toHaveBeenCalledTimes(1);
    expect(clearHistoryCachesMock).toHaveBeenCalledTimes(1);
    expect(clearFavouritesCachesMock).toHaveBeenCalledTimes(1);
    expect(resetRuntimeProfilingMock).toHaveBeenCalledTimes(1);
  });
});