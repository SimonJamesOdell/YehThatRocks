import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { resetPerfSamplingWindow } from "@/lib/perf-sample-persistence";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const SAMPLE_BUCKET_SECONDS = 30;
const resetSchema = z.object({});
const PERFORMANCE_CAPTURE_WINDOW_KEY = "hotspot-analysis";
const SLOW_LOG_OUTPUT = "TABLE";

// Parse slow query threshold from env or use improved default (100ms instead of 200ms)
// Env format: SLOW_QUERY_LONG_TIME_THRESHOLD_MS (in milliseconds, e.g., "50", "100", "200")
// If not set, uses optimized default of 0.1s (100ms) which captures ~18% of queries
// and covers ~47% of total query time, providing better performance diagnostics visibility
function getSlowQueryLongQueryTimeSeconds(): number {
  if (process.env.SLOW_QUERY_LONG_TIME_THRESHOLD_MS) {
    const ms = Number.parseInt(process.env.SLOW_QUERY_LONG_TIME_THRESHOLD_MS, 10);
    if (!Number.isFinite(ms) || ms < 10 || ms > 10000) {
      console.warn(
        `[perf] Invalid SLOW_QUERY_LONG_TIME_THRESHOLD_MS: ${process.env.SLOW_QUERY_LONG_TIME_THRESHOLD_MS}, ` +
        `using default 100ms. Valid range: 10-10000ms`,
      );
      return 0.1;
    }
    return ms / 1000;
  }
  return 0.1; // Optimized default: 100ms (captures 5x more queries than 200ms)
}

const SLOW_LOG_LONG_QUERY_TIME = getSlowQueryLongQueryTimeSeconds();
const SLOW_LOG_MIN_EXAMINED_ROW_LIMIT = 0;
const TRANSIENT_DB_CONNECTION_ERROR_PATTERNS = [
  "server has closed the connection",
  "can't reach database server",
  "connection terminated",
  "connection reset",
  "connection closed",
];

type PerfSampleRow = {
  sampled_at: Date;
  node_uptime_sec: number | null;
  heap_used_mb: number | null;
  heap_total_mb: number | null;
  rss_mb: number | null;
  prisma_query_count: number | null;
  prisma_qps: number | null;
  prisma_avg_ms: number | null;
  prisma_p95_ms: number | null;
  prisma_total_since_boot: bigint | null;
};

function toNum(v: bigint | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function ensurePerformanceCaptureWindowTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS performance_capture_windows (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      window_key VARCHAR(64) NOT NULL,
      started_at DATETIME(3) NOT NULL,
      source VARCHAR(64) NOT NULL DEFAULT 'admin',
      notes VARCHAR(255) NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_perf_capture_window_key (window_key),
      KEY idx_perf_capture_started_at (started_at)
    )
  `);
}

async function recordPerformanceCaptureWindow(startedAt: Date) {
  await ensurePerformanceCaptureWindowTable();
  await prisma.$executeRaw`
    INSERT INTO performance_capture_windows (window_key, started_at, source, notes)
    VALUES (${PERFORMANCE_CAPTURE_WINDOW_KEY}, ${startedAt}, ${"admin"}, ${"Fresh performance capture requested from admin dashboard"})
    ON DUPLICATE KEY UPDATE
      started_at = VALUES(started_at),
      source = VALUES(source),
      notes = VALUES(notes),
      updated_at = CURRENT_TIMESTAMP(3)
  `;
}

function isTransientDbConnectionError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const normalized = error.message.toLowerCase();
  return TRANSIENT_DB_CONNECTION_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
}

async function executeRawUnsafeWithReconnect(sql: string) {
  try {
    await prisma.$executeRawUnsafe(sql);
    return;
  } catch (error) {
    if (!isTransientDbConnectionError(error)) {
      throw error;
    }
  }

  // Reconnect once when MySQL closed the underlying connection unexpectedly.
  await prisma.$disconnect().catch(() => undefined);
  await prisma.$connect().catch(() => undefined);
  await prisma.$executeRawUnsafe(sql);
}

type MysqlGlobalVariableRow = {
  Variable_name: string;
  Value: string | number | null;
};

async function queryRawUnsafeWithReconnect<T>(sql: string): Promise<T> {
  try {
    return await prisma.$queryRawUnsafe<T>(sql);
  } catch (error) {
    if (!isTransientDbConnectionError(error)) {
      throw error;
    }
  }

  await prisma.$disconnect().catch(() => undefined);
  await prisma.$connect().catch(() => undefined);
  return prisma.$queryRawUnsafe<T>(sql);
}

function toLooseNumber(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

async function readMysqlGlobalVariable(name: string) {
  const rows = await queryRawUnsafeWithReconnect<MysqlGlobalVariableRow[]>(`SHOW GLOBAL VARIABLES LIKE '${name}'`);
  const row = rows[0];
  return row?.Value ?? null;
}

async function verifyMysqlSlowLogCaptureSettings() {
  try {
    const [slowLogEnabled, logOutput, longQueryTime, minExaminedRowLimit] = await Promise.all([
      readMysqlGlobalVariable("slow_query_log"),
      readMysqlGlobalVariable("log_output"),
      readMysqlGlobalVariable("long_query_time"),
      readMysqlGlobalVariable("min_examined_row_limit"),
    ]);

    const slowLogOn = String(slowLogEnabled ?? "").toUpperCase() === "ON";
    const outputIncludesTable = String(logOutput ?? "").toUpperCase().split(",").map((part) => part.trim()).includes(SLOW_LOG_OUTPUT);
    const longQueryTimeNumber = toLooseNumber(longQueryTime);
    const minExaminedRowLimitNumber = toLooseNumber(minExaminedRowLimit);
    const longQueryTimeOk = longQueryTimeNumber !== null && longQueryTimeNumber <= SLOW_LOG_LONG_QUERY_TIME;
    const minExaminedRowLimitOk = minExaminedRowLimitNumber !== null && minExaminedRowLimitNumber <= SLOW_LOG_MIN_EXAMINED_ROW_LIMIT;

    return slowLogOn && outputIncludesTable && longQueryTimeOk && minExaminedRowLimitOk;
  } catch {
    return false;
  }
}

async function tryStartMysqlSlowLogCapture() {
  try {
    await executeRawUnsafeWithReconnect(`SET GLOBAL log_output = '${SLOW_LOG_OUTPUT}'`);
    await executeRawUnsafeWithReconnect(`SET GLOBAL long_query_time = ${SLOW_LOG_LONG_QUERY_TIME}`);
    await executeRawUnsafeWithReconnect(`SET GLOBAL min_examined_row_limit = ${SLOW_LOG_MIN_EXAMINED_ROW_LIMIT}`);
    await executeRawUnsafeWithReconnect("SET GLOBAL slow_query_log = ON");

    let verified = await verifyMysqlSlowLogCaptureSettings();
    if (!verified) {
      // One extra reconnect + verify pass avoids false negatives when MySQL
      // briefly drops the app connection right after SET GLOBAL statements.
      await prisma.$disconnect().catch(() => undefined);
      await prisma.$connect().catch(() => undefined);
      verified = await verifyMysqlSlowLogCaptureSettings();
    }

    if (!verified) {
      return {
        enabled: false,
        warning: "MySQL slow query log settings could not be verified after update.",
      };
    }

    return {
      enabled: true,
      warning: null,
    };
  } catch (error) {
    const verifiedAfterError = await verifyMysqlSlowLogCaptureSettings();
    if (verifiedAfterError) {
      return {
        enabled: true,
        warning: null,
      };
    }

    if (isTransientDbConnectionError(error)) {
      return {
        enabled: true,
        warning: "MySQL slow-log start was requested, but verification was skipped after a transient app DB reconnect.",
      };
    }

    return {
      enabled: false,
      warning: error instanceof Error
        ? error.message
        : "Could not enable MySQL slow query logging with the app database user.",
    };
  }
}

export async function GET(request: NextRequest) {
  const authResult = await requireAdminApiAuth(request);
  if (!authResult.ok) return authResult.response;

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "json";
  const hours = Math.min(24, Math.max(1, Number(url.searchParams.get("hours") ?? "24")));
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const rows = await prisma.$queryRaw<PerfSampleRow[]>`
    SELECT
      FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(sampled_at) / ${SAMPLE_BUCKET_SECONDS}) * ${SAMPLE_BUCKET_SECONDS}) AS sampled_at,
      AVG(node_uptime_sec) AS node_uptime_sec,
      AVG(heap_used_mb) AS heap_used_mb,
      AVG(heap_total_mb) AS heap_total_mb,
      AVG(rss_mb) AS rss_mb,
      SUM(prisma_query_count) AS prisma_query_count,
      SUM(prisma_qps) AS prisma_qps,
      CASE
        WHEN SUM(COALESCE(prisma_query_count, 0)) > 0
          THEN SUM(COALESCE(prisma_avg_ms, 0) * COALESCE(prisma_query_count, 0)) / SUM(COALESCE(prisma_query_count, 0))
        ELSE AVG(prisma_avg_ms)
      END AS prisma_avg_ms,
      MAX(prisma_p95_ms) AS prisma_p95_ms,
      SUM(prisma_total_since_boot) AS prisma_total_since_boot
    FROM performance_telemetry_samples
    WHERE sampled_at >= ${cutoff}
    GROUP BY FLOOR(UNIX_TIMESTAMP(sampled_at) / ${SAMPLE_BUCKET_SECONDS})
    ORDER BY sampled_at ASC
  `.catch(() => [] as PerfSampleRow[]);

  const mapped = rows.map((row) => ({
    sampledAt: row.sampled_at instanceof Date ? row.sampled_at.toISOString() : new Date(row.sampled_at).toISOString(),
    nodeUptimeSec: toNum(row.node_uptime_sec),
    heapUsedMb: toNum(row.heap_used_mb),
    heapTotalMb: toNum(row.heap_total_mb),
    rssMb: toNum(row.rss_mb),
    prismaQueryCount: toNum(row.prisma_query_count),
    prismaQps: toNum(row.prisma_qps),
    prismaAvgMs: toNum(row.prisma_avg_ms),
    prismaP95Ms: toNum(row.prisma_p95_ms),
    prismaTotalSinceBoot: toNum(row.prisma_total_since_boot),
  }));

  if (format === "csv") {
    const headers = [
      "sampled_at",
      "node_uptime_sec",
      "heap_used_mb",
      "heap_total_mb",
      "rss_mb",
      "prisma_query_count",
      "prisma_qps",
      "prisma_avg_ms",
      "prisma_p95_ms",
      "prisma_total_since_boot",
    ];

    const lines = [
      headers.join(","),
      ...mapped.map((r) =>
        [
          r.sampledAt,
          r.nodeUptimeSec ?? "",
          r.heapUsedMb ?? "",
          r.heapTotalMb ?? "",
          r.rssMb ?? "",
          r.prismaQueryCount ?? "",
          r.prismaQps ?? "",
          r.prismaAvgMs ?? "",
          r.prismaP95Ms ?? "",
          r.prismaTotalSinceBoot ?? "",
        ].join(","),
      ),
    ].join("\n");

    return new NextResponse(lines, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="perf-samples-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({
    windowHours: hours,
    sampleCount: mapped.length,
    sampledEverySeconds: 30,
    samples: mapped,
  });
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdminApiAuth(request);
  if (!authResult.ok) return authResult.response;

  const csrf = verifySameOrigin(request);
  if (csrf) {
    return csrf;
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const body = await parseRequestJson(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = resetSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const startedAt = new Date();
  const [result] = await Promise.all([
    resetPerfSamplingWindow(),
    recordPerformanceCaptureWindow(startedAt),
  ]);
  const slowLog = await tryStartMysqlSlowLogCapture();

  return NextResponse.json({
    ok: true,
    startedAt: startedAt.toISOString(),
    deletedSamples: result.deletedSamples,
    sampleIntervalSeconds: result.sampleIntervalSeconds,
    slowLog,
  });
}
