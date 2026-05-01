import { prisma } from "@/lib/db";

type Auth24hRow = {
  total: bigint | number;
  success: bigint | number;
  failed: bigint | number;
  uniqueIps: bigint | number;
  uniqueUsers: bigint | number;
};

type ActionBreakdownRow = {
  action: string;
  total: bigint | number;
  failed: bigint | number;
};

type TrafficRow = {
  day: Date;
  count: bigint | number;
};

type AuthAuditCounters = {
  auth24h: Auth24hRow[];
  actionBreakdown: ActionBreakdownRow[];
  traffic: TrafficRow[];
};

const AUTH_AUDIT_COUNTERS_CACHE_TTL_MS = Math.max(
  15_000,
  Math.min(30_000, Number(process.env.ADMIN_AUTH_AUDIT_COUNTERS_CACHE_TTL_MS || "20000")),
);

let authAuditCountersCache: { expiresAt: number; value: AuthAuditCounters } | null = null;
let authAuditCountersInFlight: Promise<AuthAuditCounters> | null = null;

export function clearAdminDashboardAuthAuditCountersCache() {
  authAuditCountersCache = null;
  authAuditCountersInFlight = null;
}

export async function getAdminDashboardAuthAuditCounters(): Promise<AuthAuditCounters> {
  const now = Date.now();
  if (authAuditCountersCache && authAuditCountersCache.expiresAt > now) {
    return authAuditCountersCache.value;
  }

  if (authAuditCountersInFlight) {
    return authAuditCountersInFlight;
  }

  authAuditCountersInFlight = (async () => {
    const [auth24h, actionBreakdown, traffic] = await Promise.all([
      prisma.$queryRaw<Auth24hRow[]>`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed,
          COUNT(DISTINCT NULLIF(TRIM(ip_address), '')) AS uniqueIps,
          COUNT(DISTINCT user_id) AS uniqueUsers
        FROM auth_audit_logs
        WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
      `.catch(() => []),
      prisma.$queryRaw<ActionBreakdownRow[]>`
        SELECT
          action,
          COUNT(*) AS total,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed
        FROM auth_audit_logs
        WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
        GROUP BY action
        ORDER BY total DESC
        LIMIT 8
      `.catch(() => []),
      prisma.$queryRaw<TrafficRow[]>`
        SELECT DATE(created_at) AS day, COUNT(*) AS count
        FROM auth_audit_logs
        WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
        GROUP BY DATE(created_at)
        ORDER BY day DESC
        LIMIT 14
      `.catch(() => []),
    ]);

    const value = { auth24h, actionBreakdown, traffic };
    authAuditCountersCache = {
      expiresAt: Date.now() + AUTH_AUDIT_COUNTERS_CACHE_TTL_MS,
      value,
    };
    return value;
  })().finally(() => {
    authAuditCountersInFlight = null;
  });

  return authAuditCountersInFlight;
}
