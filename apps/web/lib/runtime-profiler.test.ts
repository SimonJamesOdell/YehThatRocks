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
    expect(snapshot.observability.dbProfilingReport).toBeDefined();
    expect(["fresh", "stale", "missing"]).toContain(snapshot.observability.dbProfilingReport.status);
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

  it("flags elevated SQL pressure when low QPS combines with very high latency", async () => {
    const {
      getRuntimeProfilingSnapshot,
      recordPrismaOperation,
      resetRuntimeProfiling,
      isRuntimeSqlPressureElevated,
    } = await import("@/lib/runtime-profiler");

    resetRuntimeProfiling();
    for (let i = 0; i < 5; i += 1) {
      recordPrismaOperation("SQL.SELECT", 5_500);
    }

    const snapshot = getRuntimeProfilingSnapshot();
    expect(snapshot.prisma.queriesPerSec).toBeLessThanOrEqual(2);
    expect(snapshot.observability.queryPressure.status).toBe("elevated");
    expect(snapshot.observability.queryPressure.mode).toBe("low-qps-high-latency");
    expect(isRuntimeSqlPressureElevated(snapshot)).toBe(true);
  });

  it("keeps SQL pressure normal when latency is low", async () => {
    const {
      getRuntimeProfilingSnapshot,
      recordPrismaOperation,
      resetRuntimeProfiling,
      isRuntimeSqlPressureElevated,
    } = await import("@/lib/runtime-profiler");

    resetRuntimeProfiling();
    for (let i = 0; i < 300; i += 1) {
      recordPrismaOperation("SQL.SELECT", 12);
    }

    const snapshot = getRuntimeProfilingSnapshot();
    expect(snapshot.observability.queryPressure.status).toBe("normal");
    expect(snapshot.observability.queryPressure.mode).toBe("none");
    expect(isRuntimeSqlPressureElevated(snapshot)).toBe(false);
  });

  it("adds historical DB telemetry fallback when profiling report is missing", async () => {
    process.env.DATABASE_URL = "mysql://test";

    vi.doMock("@/lib/db-profiling-report-freshness", () => ({
      getDbProfilingReportFreshness: () => ({
        status: "missing",
        latestReportFile: null,
        latestReportAt: null,
        reportGeneratedAt: null,
        sampleStartedAt: null,
        sampleAgeHours: null,
        slowQueryLogStatus: "UNKNOWN",
        hasActionableSlowLogData: false,
        evidenceRecency: "none",
        primaryHotspotSignal: "runtime-prisma",
        summary: "No DB profiling report found.",
        ageHours: null,
        staleAfterHours: 72,
        isStale: true,
        checkedAt: new Date().toISOString(),
      }),
    }));

    vi.doMock("@/lib/db", () => ({
      prisma: {
        $queryRaw: vi.fn().mockResolvedValue([{
          sampleCount: 12,
          latestSampledAt: new Date("2026-05-15T00:10:00.000Z"),
          prismaAvgMs: 24.3,
          prismaP95Ms: 77.1,
          prismaPeakP95Ms: 120.4,
          prismaQpsAvg: 8.2,
          prismaQueryCountTotal: 642,
        }]),
      },
    }));

    const {
      getRuntimeProfilingSnapshotWithDbHistory,
      resetRuntimeProfiling,
    } = await import("@/lib/runtime-profiler");

    resetRuntimeProfiling();
    const snapshot = await getRuntimeProfilingSnapshotWithDbHistory();

    expect(snapshot.observability.dbProfilingReport.status).toBe("missing");
    expect(snapshot.observability.dbHistoricalProfiling).toBeTruthy();
    expect(snapshot.observability.dbHistoricalProfiling?.status).toBe("available");
    expect(snapshot.observability.dbHistoricalProfiling?.sampleCount).toBe(12);
  });

  it("does not query DB history fallback when profiling report is present", async () => {
    process.env.DATABASE_URL = "mysql://test";

    const queryRawMock = vi.fn().mockResolvedValue([]);

    vi.doMock("@/lib/db-profiling-report-freshness", () => ({
      getDbProfilingReportFreshness: () => ({
        status: "fresh",
        latestReportFile: "db-profiling-report-20260501-120000.txt",
        latestReportAt: new Date("2026-05-15T00:00:00.000Z").toISOString(),
        reportGeneratedAt: new Date("2026-05-15T00:00:00.000Z").toISOString(),
        sampleStartedAt: new Date("2026-05-14T23:00:00.000Z").toISOString(),
        sampleAgeHours: 1,
        slowQueryLogStatus: "ON",
        hasActionableSlowLogData: true,
        evidenceRecency: "current",
        primaryHotspotSignal: "slow-log-and-runtime",
        summary: "DB profiling report is fresh.",
        ageHours: 1,
        staleAfterHours: 72,
        isStale: false,
        checkedAt: new Date().toISOString(),
      }),
    }));

    vi.doMock("@/lib/db", () => ({
      prisma: {
        $queryRaw: queryRawMock,
      },
    }));

    const {
      getRuntimeProfilingSnapshotWithDbHistory,
      resetRuntimeProfiling,
    } = await import("@/lib/runtime-profiler");

    resetRuntimeProfiling();
    const snapshot = await getRuntimeProfilingSnapshotWithDbHistory();

    expect(snapshot.observability.dbProfilingReport.status).toBe("fresh");
    expect(snapshot.observability.dbHistoricalProfiling).toBeNull();
    expect(queryRawMock).not.toHaveBeenCalled();
  });
});
