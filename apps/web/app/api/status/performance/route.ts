import { NextResponse } from "next/server";

import { buildAdminHealthPayload } from "@/lib/admin-dashboard-health";

export async function GET() {
  const payload = await buildAdminHealthPayload();

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
  }, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}