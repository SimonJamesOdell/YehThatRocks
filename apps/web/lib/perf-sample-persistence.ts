import { getRuntimeProfilingSnapshot, resetRuntimeProfiling } from "@/lib/runtime-profiler";

const PERF_SAMPLE_INTERVAL_MS = 30_000; // sample every 30 seconds
const PERF_SAMPLE_WINDOW_MS = 24 * 60 * 60 * 1000; // keep 24 hours
const PERF_PRUNE_EVERY_N_SAMPLES = 20; // prune once per ~10 minutes

let perfSamplingStarted = false;
let samplesSinceLastPrune = 0;
let lastSampledAtMs: number | null = null;
let lastSampleTotalQueries: number | null = null;

async function getPrismaClient() {
  const { prisma } = await import("@/lib/db");
  return prisma;
}

async function ensurePerfTelemetryTable() {
  const prisma = await getPrismaClient();
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS performance_telemetry_samples (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      sampled_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      node_uptime_sec FLOAT NULL,
      heap_used_mb FLOAT NULL,
      heap_total_mb FLOAT NULL,
      rss_mb FLOAT NULL,
      prisma_query_count INT NULL,
      prisma_qps FLOAT NULL,
      prisma_avg_ms FLOAT NULL,
      prisma_p95_ms FLOAT NULL,
      prisma_total_since_boot BIGINT NULL,
      KEY idx_perf_telemetry_sampled_at (sampled_at)
    )
  `);
}

let tableEnsured = false;
let ensureTablePromise: Promise<void> | null = null;

async function ensureTable() {
  if (tableEnsured) return;
  if (ensureTablePromise) return ensureTablePromise;
  ensureTablePromise = ensurePerfTelemetryTable()
    .then(() => { tableEnsured = true; })
    .catch(() => { /* retry next sample */ })
    .finally(() => { ensureTablePromise = null; });
  return ensureTablePromise;
}

async function recordPerfSample() {
  if (!process.env.DATABASE_URL) return;

  try {
    const prisma = await getPrismaClient();
    await ensureTable();
    if (!tableEnsured) return;

    const snap = getRuntimeProfilingSnapshot();
    const nowMs = Date.now();
    const now = new Date(nowMs);
    const intervalSec = lastSampledAtMs === null
      ? PERF_SAMPLE_INTERVAL_MS / 1000
      : Math.max(1, (nowMs - lastSampledAtMs) / 1000);
    const deltaQueries = lastSampleTotalQueries === null
      ? snap.prisma.totalsSinceBoot.totalQueries
      : Math.max(0, snap.prisma.totalsSinceBoot.totalQueries - lastSampleTotalQueries);

    lastSampledAtMs = nowMs;
    lastSampleTotalQueries = snap.prisma.totalsSinceBoot.totalQueries;

    await prisma.$executeRaw`
      INSERT INTO performance_telemetry_samples (
        sampled_at,
        node_uptime_sec,
        heap_used_mb,
        heap_total_mb,
        rss_mb,
        prisma_query_count,
        prisma_qps,
        prisma_avg_ms,
        prisma_p95_ms,
        prisma_total_since_boot
      ) VALUES (
        ${now},
        ${snap.node.uptimeSec},
        ${snap.node.heapUsedMb},
        ${snap.node.heapTotalMb},
        ${snap.node.rssMb},
        ${deltaQueries},
        ${deltaQueries / intervalSec},
        ${snap.prisma.avgDurationMs},
        ${snap.prisma.p95DurationMs},
        ${snap.prisma.totalsSinceBoot.totalQueries}
      )
    `;

    samplesSinceLastPrune++;
    if (samplesSinceLastPrune >= PERF_PRUNE_EVERY_N_SAMPLES) {
      samplesSinceLastPrune = 0;
      const cutoff = new Date(Date.now() - PERF_SAMPLE_WINDOW_MS);
      void prisma.$executeRaw`
        DELETE FROM performance_telemetry_samples
        WHERE sampled_at < ${cutoff}
      `.catch(() => {});
    }
  } catch {
    // Best-effort — never crash the app due to telemetry
  }
}

export async function resetPerfSamplingWindow() {
  if (!process.env.DATABASE_URL) {
    return {
      startedAt: new Date().toISOString(),
      deletedSamples: 0,
      sampleIntervalSeconds: PERF_SAMPLE_INTERVAL_MS / 1000,
    };
  }

  const prisma = await getPrismaClient();
  await ensureTable();

  let deletedSamples = 0;

  try {
    const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
      SELECT COUNT(*) AS count
      FROM performance_telemetry_samples
    `;
    deletedSamples = Number(rows[0]?.count ?? 0);
  } catch {
    deletedSamples = 0;
  }

  try {
    await prisma.$executeRawUnsafe("TRUNCATE TABLE performance_telemetry_samples");
  } catch {
    await prisma.$executeRaw`DELETE FROM performance_telemetry_samples`;
  }

  samplesSinceLastPrune = 0;
  lastSampledAtMs = null;
  lastSampleTotalQueries = null;
  resetRuntimeProfiling();

  await recordPerfSample();

  return {
    startedAt: new Date().toISOString(),
    deletedSamples,
    sampleIntervalSeconds: PERF_SAMPLE_INTERVAL_MS / 1000,
  };
}

export function startPerfSampling() {
  if (perfSamplingStarted || !process.env.DATABASE_URL) return;
  perfSamplingStarted = true;

  void recordPerfSample();
  const timer = setInterval(() => void recordPerfSample(), PERF_SAMPLE_INTERVAL_MS);
  timer.unref?.();
}
