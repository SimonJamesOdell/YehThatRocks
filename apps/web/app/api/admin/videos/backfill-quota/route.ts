import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { hasDatabaseUrl, runQuotaBackfill } from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { parseRequestJson } from "@/lib/request-json";

const DAILY_QUOTA = 10_000;
const QUOTA_SAFETY_BUFFER = 200;

const backfillSchema = z.object({
  budgetUnits: z.number().int().min(100).max(DAILY_QUOTA),
});

function getNextPacificMidnightMs(): number {
  const now = new Date();
  const pacificNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  pacificNow.setDate(pacificNow.getDate() + 1);
  pacificNow.setHours(0, 0, 0, 0);
  const offsetMs = now.getTime() - new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })).getTime();
  return pacificNow.getTime() + offsetMs;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const quotaResetAtMs = getNextPacificMidnightMs();
  const msUntilReset = Math.max(0, quotaResetAtMs - Date.now());

  let todayUsageUnits = 0;
  let availableSeedCount = 0;

  if (hasDatabaseUrl()) {
    try {
      const pacificDayStart = new Date(quotaResetAtMs - 24 * 60 * 60 * 1000);
      const [usageRows, seedRows] = await Promise.all([
        prisma.$queryRaw<Array<{ total: bigint }>>`
          SELECT COALESCE(SUM(units), 0) AS total
          FROM external_api_usage_events
          WHERE provider = 'youtube'
            AND created_at >= ${pacificDayStart}
        `,
        prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) AS count
          FROM videos v
          WHERE NOT EXISTS (SELECT 1 FROM related r WHERE r.videoId = v.videoId)
        `,
      ]);
      todayUsageUnits = Number(usageRows[0]?.total ?? 0);
      availableSeedCount = Number(seedRows[0]?.count ?? 0);
    } catch {
      // telemetry / related tables may not exist yet — non-fatal
    }
  }

  const remainingUnits = Math.max(0, DAILY_QUOTA - todayUsageUnits);
  const recommendedBudget = Math.max(0, remainingUnits - QUOTA_SAFETY_BUFFER);

  return NextResponse.json({
    ok: true,
    todayUsageUnits,
    remainingUnits,
    recommendedBudget,
    availableSeedCount,
    quotaResetAt: new Date(quotaResetAtMs).toISOString(),
    msUntilReset,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const csrf = verifySameOrigin(request);
  if (csrf) {
    return csrf;
  }

  const body = await parseRequestJson(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = backfillSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await runQuotaBackfill(parsed.data.budgetUnits);

  return NextResponse.json({ ok: true, ...result });
}
