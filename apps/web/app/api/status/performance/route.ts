import { NextResponse } from "next/server";

import { buildPublicPerformancePayload } from "@/lib/admin-dashboard-health";
import { getRuntimeProfilingSnapshotWithDbHistory } from "@/lib/runtime-profiler";

export async function GET() {
  const payload = await buildPublicPerformancePayload();
  const runtime = await getRuntimeProfilingSnapshotWithDbHistory();

  return NextResponse.json({
    meta: payload.meta,
    host: {
      cpuUsagePercent: payload.health.host.cpuUsagePercent,
      cpuAverageUsagePercent: payload.health.host.cpuAverageUsagePercent,
      cpuPeakCoreUsagePercent: payload.health.host.cpuPeakCoreUsagePercent,
      memoryUsagePercent: payload.health.host.memoryUsagePercent,
      diskUsagePercent: null,
      swapUsagePercent: null,
      networkUsagePercent: null,
    },
    runtime,
  }, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}