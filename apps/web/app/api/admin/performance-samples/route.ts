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
const SLOW_LOG_LONG_QUERY_TIME = 0.2;
const SLOW_LOG_MIN_EXAMINED_ROW_LIMIT = 0;

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

async function tryStartMysqlSlowLogCapture() {
  try {
    await prisma.$executeRawUnsafe(`SET GLOBAL log_output = '${SLOW_LOG_OUTPUT}'`);
    await prisma.$executeRawUnsafe(`SET GLOBAL long_query_time = ${SLOW_LOG_LONG_QUERY_TIME}`);
    await prisma.$executeRawUnsafe(`SET GLOBAL min_examined_row_limit = ${SLOW_LOG_MIN_EXAMINED_ROW_LIMIT}`);
    await prisma.$executeRawUnsafe("SET GLOBAL slow_query_log = ON");

    return {
      enabled: true,
      warning: null,
    };
  } catch (error) {
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
  const [result, slowLog] = await Promise.all([
    resetPerfSamplingWindow(),
    tryStartMysqlSlowLogCapture(),
    recordPerformanceCaptureWindow(startedAt),
  ]);

  return NextResponse.json({
    ok: true,
    startedAt: startedAt.toISOString(),
    deletedSamples: result.deletedSamples,
    sampleIntervalSeconds: result.sampleIntervalSeconds,
    slowLog,
  });
}
