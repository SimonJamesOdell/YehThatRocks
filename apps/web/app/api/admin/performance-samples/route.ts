import { NextRequest, NextResponse } from "next/server";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";

const WINDOW_MS = 24 * 60 * 60 * 1000;

type PerfSampleRow = {
  id: bigint;
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
      id,
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
    FROM performance_telemetry_samples
    WHERE sampled_at >= ${cutoff}
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
