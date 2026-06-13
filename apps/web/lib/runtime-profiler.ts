type TimedEvent = {
  atMs: number;
  key: string;
  durationMs: number;
};

import { readPositiveIntEnv } from "@/lib/number-utils";
import { getDbProfilingReportFreshness, type DbProfilingReportFreshness } from "@/lib/db-profiling-report-freshness";

type OperationAggregate = {
  operation: string;
  count: number;
  totalDurationMs: number;
  avgDurationMs: number;
  p95DurationMs: number;
};

type QueryFingerprintAggregate = {
  fingerprint: string;
  count: number;
  totalDurationMs: number;
  avgDurationMs: number;
  p95DurationMs: number;
};

type PrismaProfilingSnapshot = {
  windowSec: number;
  totalQueries: number;
  queriesPerSec: number;
  avgDurationMs: number;
  p95DurationMs: number;
  topOperations: OperationAggregate[];
  topQueryFingerprints: QueryFingerprintAggregate[];
  totalsSinceBoot: {
    totalQueries: number;
    totalDurationMs: number;
  };
};

type RuntimeProfilingSnapshot = {
  node: {
    uptimeSec: number;
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
  };
  observability: {
    dbProfilingReport: DbProfilingReportFreshness;
    dbHistoricalProfiling: DbHistoricalProfilingSummary | null;
    queryPressure: QueryPressureSignal;
  };
  prisma: PrismaProfilingSnapshot;
};

type QueryPressureSignal = {
  status: "normal" | "elevated";
  mode: "none" | "low-qps-high-latency";
  qps: number;
  avgMs: number;
  p95Ms: number;
  summary: string;
};

type DbHistoricalProfilingSummary = {
  status: "available" | "unavailable";
  source: "performance_telemetry_samples";
  windowHours: number;
  sampleCount: number;
  latestSampledAt: string | null;
  prismaAvgMs: number | null;
  prismaP95Ms: number | null;
  prismaPeakP95Ms: number | null;
  prismaQpsAvg: number | null;
  prismaQueryCountTotal: number;
  summary: string;
};

type DbHistoricalProfilingCacheEntry = {
  expiresAt: number;
  summary: DbHistoricalProfilingSummary;
};

type SnapshotCacheEntry = {
  expiresAt: number;
  snapshot: RuntimeProfilingSnapshot;
};

const PROFILING_WINDOW_MS = 5 * 60 * 1000;
const MAX_TOP_OPERATIONS = 8;

const MAX_PRISMA_OPERATION_EVENTS = readPositiveIntEnv(
  "PRISMA_PROFILER_MAX_OPERATION_EVENTS",
  4_000,
  500,
  20_000,
);
const MAX_PRISMA_FINGERPRINT_EVENTS = readPositiveIntEnv(
  "PRISMA_PROFILER_MAX_FINGERPRINT_EVENTS",
  2_500,
  500,
  20_000,
);
const RUNTIME_PROFILING_SNAPSHOT_TTL_MS = readPositiveIntEnv(
  "RUNTIME_PROFILING_SNAPSHOT_TTL_MS",
  3_000,
  250,
  10_000,
);
const DB_HISTORY_WINDOW_HOURS = readPositiveIntEnv(
  "RUNTIME_DB_HISTORY_WINDOW_HOURS",
  24,
  1,
  7 * 24,
);
const DB_HISTORY_SUMMARY_CACHE_TTL_MS = readPositiveIntEnv(
  "RUNTIME_DB_HISTORY_CACHE_TTL_MS",
  30_000,
  1_000,
  5 * 60_000,
);
const QUERY_PRESSURE_QPS_MAX = readPositiveIntEnv(
  "RUNTIME_QUERY_PRESSURE_QPS_MAX",
  2,
  1,
  20,
);
const QUERY_PRESSURE_AVG_MS_MIN = readPositiveIntEnv(
  "RUNTIME_QUERY_PRESSURE_AVG_MS_MIN",
  350,
  50,
  10_000,
);
const QUERY_PRESSURE_P95_MS_MIN = readPositiveIntEnv(
  "RUNTIME_QUERY_PRESSURE_P95_MS_MIN",
  2_000,
  100,
  60_000,
);

const prismaEvents: TimedEvent[] = [];
const prismaFingerprintEvents: TimedEvent[] = [];
let totalPrismaQueriesSinceBoot = 0;
let totalPrismaDurationMsSinceBoot = 0;
let runtimeProfilingSnapshotCache: SnapshotCacheEntry | null = null;
let dbHistoricalProfilingCache: DbHistoricalProfilingCacheEntry | null = null;
let dbHistoricalProfilingInFlight: Promise<DbHistoricalProfilingSummary> | null = null;

function round(value: number, digits = 2) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function pruneEvents(events: TimedEvent[], maxEvents: number, now = Date.now()) {
  const cutoff = now - PROFILING_WINDOW_MS;
  while (events.length > 0 && events[0] && events[0].atMs < cutoff) {
    events.shift();
  }

  if (events.length > maxEvents) {
    events.splice(0, events.length - maxEvents);
  }
}

function buildTimedAggregates(events: TimedEvent[]) {
  const grouped = new Map<string, number[]>();

  for (const event of events) {
    const list = grouped.get(event.key);
    if (list) {
      list.push(event.durationMs);
      continue;
    }

    grouped.set(event.key, [event.durationMs]);
  }

  const aggregates = Array.from(grouped.entries()).map(([key, durations]) => {
    const totalDurationMs = durations.reduce((acc, value) => acc + value, 0);
    return {
      key,
      count: durations.length,
      totalDurationMs: round(totalDurationMs, 1),
      avgDurationMs: round(totalDurationMs / Math.max(1, durations.length), 1),
      p95DurationMs: round(percentile(durations, 95), 1),
    };
  });

  aggregates.sort((a, b) => {
    if (b.totalDurationMs !== a.totalDurationMs) {
      return b.totalDurationMs - a.totalDurationMs;
    }

    return b.count - a.count;
  });

  return aggregates.slice(0, MAX_TOP_OPERATIONS);
}

function buildOperationAggregates(events: TimedEvent[]): OperationAggregate[] {
  return buildTimedAggregates(events).map(({ key, ...aggregate }) => ({
    operation: key,
    ...aggregate,
  }));
}

function buildFingerprintAggregates(events: TimedEvent[]): QueryFingerprintAggregate[] {
  return buildTimedAggregates(events).map(({ key, ...aggregate }) => ({
    fingerprint: key,
    ...aggregate,
  }));
}

function clearRuntimeProfilingSnapshotCache() {
  runtimeProfilingSnapshotCache = null;
}

function clearDbHistoricalProfilingCache() {
  dbHistoricalProfilingCache = null;
}

function buildQueryPressureSignal(prisma: PrismaProfilingSnapshot): QueryPressureSignal {
  const qps = Math.max(0, Number(prisma.queriesPerSec || 0));
  const avgMs = Math.max(0, Number(prisma.avgDurationMs || 0));
  const p95Ms = Math.max(0, Number(prisma.p95DurationMs || 0));
  const lowQpsHighLatency = qps <= QUERY_PRESSURE_QPS_MAX
    && (avgMs >= QUERY_PRESSURE_AVG_MS_MIN || p95Ms >= QUERY_PRESSURE_P95_MS_MIN);

  if (lowQpsHighLatency) {
    return {
      status: "elevated",
      mode: "low-qps-high-latency",
      qps: round(qps, 2),
      avgMs: round(avgMs, 1),
      p95Ms: round(p95Ms, 1),
      summary: "Low query throughput with high latency indicates heavy analytical SQL pressure.",
    };
  }

  return {
    status: "normal",
    mode: "none",
    qps: round(qps, 2),
    avgMs: round(avgMs, 1),
    p95Ms: round(p95Ms, 1),
    summary: "Runtime SQL pressure is within expected bounds.",
  };
}

export function isRuntimeSqlPressureElevated(snapshot: RuntimeProfilingSnapshot) {
  return snapshot.observability.queryPressure.status === "elevated";
}

type HistoricalPerfSampleSummaryRow = {
  sampleCount: bigint | number | null;
  latestSampledAt: Date | null;
  prismaAvgMs: number | null;
  prismaP95Ms: number | null;
  prismaPeakP95Ms: number | null;
  prismaQpsAvg: number | null;
  prismaQueryCountTotal: bigint | number | null;
};

async function queryDbHistoricalProfilingSummary(now: Date): Promise<DbHistoricalProfilingSummary> {
  if (!process.env.DATABASE_URL) {
    return {
      status: "unavailable",
      source: "performance_telemetry_samples",
      windowHours: DB_HISTORY_WINDOW_HOURS,
      sampleCount: 0,
      latestSampledAt: null,
      prismaAvgMs: null,
      prismaP95Ms: null,
      prismaPeakP95Ms: null,
      prismaQpsAvg: null,
      prismaQueryCountTotal: 0,
      summary: "Historical DB telemetry unavailable: database is not configured.",
    };
  }

  const cutoff = new Date(now.getTime() - DB_HISTORY_WINDOW_HOURS * 60 * 60 * 1000);

  try {
    const { prisma } = await import("@/lib/db");
    const rows = await prisma.$queryRaw<HistoricalPerfSampleSummaryRow[]>`
      SELECT
        COUNT(*) AS sampleCount,
        MAX(sampled_at) AS latestSampledAt,
        AVG(prisma_avg_ms) AS prismaAvgMs,
        AVG(prisma_p95_ms) AS prismaP95Ms,
        MAX(prisma_p95_ms) AS prismaPeakP95Ms,
        AVG(prisma_qps) AS prismaQpsAvg,
        SUM(prisma_query_count) AS prismaQueryCountTotal
      FROM performance_telemetry_samples
      WHERE sampled_at >= ${cutoff}
    `;

    const row = rows[0];
    const sampleCount = Math.max(0, Number(row?.sampleCount ?? 0));
    const latestSampledAt = row?.latestSampledAt ? row.latestSampledAt.toISOString() : null;
    const prismaQueryCountTotal = Math.max(0, Number(row?.prismaQueryCountTotal ?? 0));
    const prismaAvgMs = row?.prismaAvgMs == null ? null : round(Number(row.prismaAvgMs), 1);
    const prismaP95Ms = row?.prismaP95Ms == null ? null : round(Number(row.prismaP95Ms), 1);
    const prismaPeakP95Ms = row?.prismaPeakP95Ms == null ? null : round(Number(row.prismaPeakP95Ms), 1);
    const prismaQpsAvg = row?.prismaQpsAvg == null ? null : round(Number(row.prismaQpsAvg), 2);

    if (sampleCount <= 0) {
      return {
        status: "unavailable",
        source: "performance_telemetry_samples",
        windowHours: DB_HISTORY_WINDOW_HOURS,
        sampleCount: 0,
        latestSampledAt: null,
        prismaAvgMs,
        prismaP95Ms,
        prismaPeakP95Ms,
        prismaQpsAvg,
        prismaQueryCountTotal,
        summary: `No historical performance telemetry rows found in the last ${DB_HISTORY_WINDOW_HOURS}h.`,
      };
    }

    return {
      status: "available",
      source: "performance_telemetry_samples",
      windowHours: DB_HISTORY_WINDOW_HOURS,
      sampleCount,
      latestSampledAt,
      prismaAvgMs,
      prismaP95Ms,
      prismaPeakP95Ms,
      prismaQpsAvg,
      prismaQueryCountTotal,
      summary: `Historical DB telemetry available from ${sampleCount} samples over ${DB_HISTORY_WINDOW_HOURS}h.`,
    };
  } catch {
    return {
      status: "unavailable",
      source: "performance_telemetry_samples",
      windowHours: DB_HISTORY_WINDOW_HOURS,
      sampleCount: 0,
      latestSampledAt: null,
      prismaAvgMs: null,
      prismaP95Ms: null,
      prismaPeakP95Ms: null,
      prismaQpsAvg: null,
      prismaQueryCountTotal: 0,
      summary: "Historical DB telemetry unavailable: performance sample table is not readable.",
    };
  }
}

async function getDbHistoricalProfilingSummary(now = new Date()) {
  const nowMs = now.getTime();
  if (dbHistoricalProfilingCache && dbHistoricalProfilingCache.expiresAt > nowMs) {
    return dbHistoricalProfilingCache.summary;
  }

  if (!dbHistoricalProfilingInFlight) {
    dbHistoricalProfilingInFlight = queryDbHistoricalProfilingSummary(now)
      .then((summary) => {
        dbHistoricalProfilingCache = {
          summary,
          expiresAt: nowMs + DB_HISTORY_SUMMARY_CACHE_TTL_MS,
        };
        return summary;
      })
      .finally(() => {
        dbHistoricalProfilingInFlight = null;
      });
  }

  return dbHistoricalProfilingInFlight;
}

export function recordPrismaOperation(operation: string, durationMs: number) {
  const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const event: TimedEvent = {
    atMs: Date.now(),
    key: operation,
    durationMs: safeDurationMs,
  };

  prismaEvents.push(event);
  totalPrismaQueriesSinceBoot += 1;
  totalPrismaDurationMsSinceBoot += safeDurationMs;
  pruneEvents(prismaEvents, MAX_PRISMA_OPERATION_EVENTS, event.atMs);
  clearRuntimeProfilingSnapshotCache();
}

export function recordPrismaQueryFingerprint(fingerprint: string, durationMs: number) {
  const key = fingerprint.trim();
  if (!key) {
    return;
  }

  const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const event: TimedEvent = {
    atMs: Date.now(),
    key,
    durationMs: safeDurationMs,
  };

  prismaFingerprintEvents.push(event);
  pruneEvents(prismaFingerprintEvents, MAX_PRISMA_FINGERPRINT_EVENTS, event.atMs);
  clearRuntimeProfilingSnapshotCache();
}

export function resetRuntimeProfiling() {
  prismaEvents.length = 0;
  prismaFingerprintEvents.length = 0;
  totalPrismaQueriesSinceBoot = 0;
  totalPrismaDurationMsSinceBoot = 0;
  clearRuntimeProfilingSnapshotCache();
  clearDbHistoricalProfilingCache();
}

export function getRuntimeProfilingSnapshot(): RuntimeProfilingSnapshot {
  const now = Date.now();
  if (runtimeProfilingSnapshotCache && runtimeProfilingSnapshotCache.expiresAt > now) {
    return runtimeProfilingSnapshotCache.snapshot;
  }

  pruneEvents(prismaEvents, MAX_PRISMA_OPERATION_EVENTS, now);
  pruneEvents(prismaFingerprintEvents, MAX_PRISMA_FINGERPRINT_EVENTS, now);

  const windowSec = PROFILING_WINDOW_MS / 1000;
  const durations = prismaEvents.map((event) => event.durationMs);
  const totalDurationMs = durations.reduce((acc, value) => acc + value, 0);

  const memory = process.memoryUsage();

  const snapshot: RuntimeProfilingSnapshot = {
    node: {
      uptimeSec: round(process.uptime(), 1),
      rssMb: round(memory.rss / 1024 / 1024, 1),
      heapUsedMb: round(memory.heapUsed / 1024 / 1024, 1),
      heapTotalMb: round(memory.heapTotal / 1024 / 1024, 1),
    },
    observability: {
      dbProfilingReport: getDbProfilingReportFreshness({ nowMs: now }),
      dbHistoricalProfiling: null,
      queryPressure: {
        status: "normal",
        mode: "none",
        qps: 0,
        avgMs: 0,
        p95Ms: 0,
        summary: "Runtime SQL pressure is within expected bounds.",
      },
    },
    prisma: {
      windowSec,
      totalQueries: prismaEvents.length,
      queriesPerSec: round(prismaEvents.length / Math.max(1, windowSec), 2),
      avgDurationMs: round(totalDurationMs / Math.max(1, prismaEvents.length), 1),
      p95DurationMs: round(percentile(durations, 95), 1),
      topOperations: buildOperationAggregates(prismaEvents),
      topQueryFingerprints: buildFingerprintAggregates(prismaFingerprintEvents),
      totalsSinceBoot: {
        totalQueries: totalPrismaQueriesSinceBoot,
        totalDurationMs: round(totalPrismaDurationMsSinceBoot, 1),
      },
    },
  };

  snapshot.observability.queryPressure = buildQueryPressureSignal(snapshot.prisma);

  runtimeProfilingSnapshotCache = {
    snapshot,
    expiresAt: now + RUNTIME_PROFILING_SNAPSHOT_TTL_MS,
  };

  return snapshot;
}

export async function getRuntimeProfilingSnapshotWithDbHistory(): Promise<RuntimeProfilingSnapshot> {
  // Lazy-start performance telemetry sampling so dbHistoricalProfiling has data.
  // Dynamic import avoids circular dependency (perf-sample-persistence imports runtime-profiler).
  void import("@/lib/perf-sample-persistence").then((m) => m.startPerfSampling());

  const snapshot = getRuntimeProfilingSnapshot();
  if (snapshot.observability.dbProfilingReport.status !== "missing") {
    return snapshot;
  }

  const dbHistoricalProfiling = await getDbHistoricalProfilingSummary();
  return {
    ...snapshot,
    observability: {
      ...snapshot.observability,
      dbHistoricalProfiling,
    },
  };
}