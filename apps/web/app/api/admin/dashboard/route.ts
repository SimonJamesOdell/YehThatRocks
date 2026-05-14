import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiAuth } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  // Read from pre-computed cache table — no side effects, super fast
  const cacheRows = await prisma.$queryRaw<Array<{ payload: string; computed_at: Date }>>`
    SELECT payload, computed_at FROM admin_dashboard_cache WHERE id = 1
  `.catch(() => []);

  if (cacheRows.length === 0) {
    return NextResponse.json({
      ok: false,
      error: "Dashboard cache not initialized. Run the maintenance cronjob first.",
    }, { status: 503 });
  }

  const cacheRow = cacheRows[0];
  const payload = JSON.parse(cacheRow.payload);

  return NextResponse.json(payload);
}
