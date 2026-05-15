import { prisma } from "@/lib/db";

export const CATALOG_REVIEW_QUEUE_COUNT_TTL_MS = Math.max(
  2_000,
  Number(process.env.CATALOG_REVIEW_QUEUE_COUNT_TTL_MS || "10000"),
);

type QueueCountCacheEntry = {
  value: number;
  expiresAt: number;
};

let queueCountCache: QueueCountCacheEntry | null = null;
let queueCountInFlight: Promise<number> | null = null;

function toSafeCount(value: unknown): number {
  if (typeof value === "bigint") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.round(numeric));
}

async function queryExactCatalogReviewQueueCount(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(`
    SELECT COUNT(*) AS total
    FROM admin_catalog_review_queue
  `);

  return toSafeCount(rows[0]?.total ?? 0);
}

export async function getCatalogReviewQueueCount(options?: { forceRefresh?: boolean }): Promise<number> {
  const forceRefresh = options?.forceRefresh === true;
  const now = Date.now();

  if (!forceRefresh && queueCountCache && queueCountCache.expiresAt > now) {
    return queueCountCache.value;
  }

  if (queueCountInFlight) {
    return queueCountInFlight;
  }

  queueCountInFlight = queryExactCatalogReviewQueueCount()
    .then((value) => {
      queueCountCache = {
        value,
        expiresAt: Date.now() + CATALOG_REVIEW_QUEUE_COUNT_TTL_MS,
      };
      return value;
    })
    .catch(() => {
      if (queueCountCache) {
        return queueCountCache.value;
      }
      return 0;
    })
    .finally(() => {
      queueCountInFlight = null;
    });

  return queueCountInFlight;
}

export async function applyCatalogReviewQueueCountDelta(delta: number): Promise<number> {
  const normalizedDelta = Number.isFinite(delta) ? Math.trunc(delta) : 0;

  if (!queueCountCache) {
    return getCatalogReviewQueueCount({ forceRefresh: true });
  }

  const nextValue = Math.max(0, queueCountCache.value + normalizedDelta);
  queueCountCache = {
    value: nextValue,
    expiresAt: Date.now() + CATALOG_REVIEW_QUEUE_COUNT_TTL_MS,
  };

  return nextValue;
}

export function clearCatalogReviewQueueCountCache() {
  queueCountCache = null;
  queueCountInFlight = null;
}
