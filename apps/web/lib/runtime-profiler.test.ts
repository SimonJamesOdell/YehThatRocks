import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("runtime profiler buffer caps", () => {
  const originalOperationCap = process.env.PRISMA_PROFILER_MAX_OPERATION_EVENTS;
  const originalFingerprintCap = process.env.PRISMA_PROFILER_MAX_FINGERPRINT_EVENTS;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.PRISMA_PROFILER_MAX_OPERATION_EVENTS = originalOperationCap;
    process.env.PRISMA_PROFILER_MAX_FINGERPRINT_EVENTS = originalFingerprintCap;
  });

  it("caps operation events while preserving totals-since-boot", async () => {
    process.env.PRISMA_PROFILER_MAX_OPERATION_EVENTS = "500";

    const {
      getRuntimeProfilingSnapshot,
      recordPrismaOperation,
      resetRuntimeProfiling,
    } = await import("@/lib/runtime-profiler");

    resetRuntimeProfiling();

    for (let i = 0; i < 800; i += 1) {
      recordPrismaOperation("SQL.SELECT", 10);
    }

    const snapshot = getRuntimeProfilingSnapshot();

    expect(snapshot.prisma.totalQueries).toBe(500);
    expect(snapshot.prisma.totalsSinceBoot.totalQueries).toBe(800);
    expect(snapshot.prisma.totalsSinceBoot.totalDurationMs).toBe(8000);
  });

  it("caps fingerprint events independently from operation events", async () => {
    process.env.PRISMA_PROFILER_MAX_OPERATION_EVENTS = "2000";
    process.env.PRISMA_PROFILER_MAX_FINGERPRINT_EVENTS = "500";

    const {
      getRuntimeProfilingSnapshot,
      recordPrismaOperation,
      recordPrismaQueryFingerprint,
      resetRuntimeProfiling,
    } = await import("@/lib/runtime-profiler");

    resetRuntimeProfiling();

    for (let i = 0; i < 900; i += 1) {
      recordPrismaOperation("SQL.SELECT", 5);
      recordPrismaQueryFingerprint("SELECT V.ID FROM VIDEOS V", 5);
    }

    const snapshot = getRuntimeProfilingSnapshot();

    expect(snapshot.prisma.totalQueries).toBe(900);
    expect(snapshot.prisma.topQueryFingerprints[0]?.count).toBe(500);
  });

  it("ignores blank fingerprint keys", async () => {
    const {
      getRuntimeProfilingSnapshot,
      recordPrismaQueryFingerprint,
      resetRuntimeProfiling,
    } = await import("@/lib/runtime-profiler");

    resetRuntimeProfiling();

    recordPrismaQueryFingerprint("   ", 12);
    const snapshot = getRuntimeProfilingSnapshot();

    expect(snapshot.prisma.topQueryFingerprints).toHaveLength(0);
  });

  it("reuses cached snapshots until the TTL expires", async () => {
    process.env.RUNTIME_PROFILING_SNAPSHOT_TTL_MS = "3000";

    const {
      getRuntimeProfilingSnapshot,
      recordPrismaOperation,
      resetRuntimeProfiling,
    } = await import("@/lib/runtime-profiler");

    resetRuntimeProfiling();
    recordPrismaOperation("SQL.SELECT", 8);

    const firstSnapshot = getRuntimeProfilingSnapshot();
    const cachedSnapshot = getRuntimeProfilingSnapshot();
    expect(cachedSnapshot.prisma.totalQueries).toBe(firstSnapshot.prisma.totalQueries);
    expect(cachedSnapshot.prisma.topOperations).toEqual(firstSnapshot.prisma.topOperations);

    recordPrismaOperation("SQL.UPDATE", 11);

    const invalidatedSnapshot = getRuntimeProfilingSnapshot();
    expect(invalidatedSnapshot.prisma.totalQueries).toBe(2);
    expect(invalidatedSnapshot.prisma.topOperations).toHaveLength(2);

    vi.advanceTimersByTime(3_001);

    const refreshedSnapshot = getRuntimeProfilingSnapshot();
    expect(refreshedSnapshot.prisma.totalQueries).toBe(2);
    expect(refreshedSnapshot.prisma.topOperations).toHaveLength(2);
  });
});
