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
      diskUsagePercent: payload.health.host.diskUsagePercent,
      swapUsagePercent: payload.health.host.swapUsagePercent,
      networkUsagePercent: payload.health.host.networkUsagePercent,
    },
    runtime,
  }, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}