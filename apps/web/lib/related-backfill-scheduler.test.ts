import { describe, expect, it } from "vitest";

import { computeRelatedBackfillDelayMs, shouldScheduleRelatedBackfill } from "@/lib/related-backfill-scheduler";

describe("related backfill scheduler", () => {
  it("blocks scheduling when disabled, offset too high, in-flight, scheduled, or cooldown active", () => {
    expect(shouldScheduleRelatedBackfill({
      enabled: false,
      offset: 0,
      maxNewestOffset: 0,
      now: 1_000,
      lastStartedAt: 0,
      minIntervalMs: 100,
      hasInFlight: false,
      hasScheduled: false,
    })).toBe(false);

    expect(shouldScheduleRelatedBackfill({
      enabled: true,
      offset: 5,
      maxNewestOffset: 0,
      now: 1_000,
      lastStartedAt: 0,
      minIntervalMs: 100,
      hasInFlight: false,
      hasScheduled: false,
    })).toBe(false);

    expect(shouldScheduleRelatedBackfill({
      enabled: true,
      offset: 0,
      maxNewestOffset: 0,
      now: 1_000,
      lastStartedAt: 0,
      minIntervalMs: 100,
      hasInFlight: true,
      hasScheduled: false,
    })).toBe(false);

    expect(shouldScheduleRelatedBackfill({
      enabled: true,
      offset: 0,
      maxNewestOffset: 0,
      now: 1_000,
      lastStartedAt: 0,
      minIntervalMs: 100,
      hasInFlight: false,
      hasScheduled: true,
    })).toBe(false);

    expect(shouldScheduleRelatedBackfill({
      enabled: true,
      offset: 0,
      maxNewestOffset: 0,
      now: 100,
      lastStartedAt: 50,
      minIntervalMs: 100,
      hasInFlight: false,
      hasScheduled: false,
    })).toBe(false);
  });

  it("allows scheduling when all constraints are satisfied", () => {
    expect(shouldScheduleRelatedBackfill({
      enabled: true,
      offset: 0,
      maxNewestOffset: 0,
      now: 1_000,
      lastStartedAt: 0,
      minIntervalMs: 100,
      hasInFlight: false,
      hasScheduled: false,
    })).toBe(true);
  });

  it("computes deterministic delay with optional jitter", () => {
    expect(computeRelatedBackfillDelayMs(5_000, 0, 0.75)).toBe(5_000);
    expect(computeRelatedBackfillDelayMs(5_000, 2_000, 0)).toBe(5_000);
    expect(computeRelatedBackfillDelayMs(5_000, 2_000, 0.5)).toBe(6_000);
    expect(computeRelatedBackfillDelayMs(5_000, 2_000, 0.9999)).toBe(6_999);
  });
});
