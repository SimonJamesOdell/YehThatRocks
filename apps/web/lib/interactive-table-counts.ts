import { prisma } from "@/lib/db";

export const INTERACTIVE_TABLE_COUNT_EXACT_TTL_MS = Math.max(
  45_000,
  Number(process.env.INTERACTIVE_TABLE_COUNT_EXACT_TTL_MS || "90000"),
);

export const INTERACTIVE_TABLE_COUNT_APPROX_TTL_MS = Math.max(
  20_000,
  Number(process.env.INTERACTIVE_TABLE_COUNT_APPROX_TTL_MS || "30000"),
);

type CountCacheEntry = {
  value: number;
  expiresAt: number;
};

const exactCountCache = new Map<string, CountCacheEntry>();
const approximateCountCache = new Map<string, CountCacheEntry>();
const exactCountInFlight = new Map<string, Promise<number>>();
const approximateCountInFlight = new Map<string, Promise<number | null>>();

function toSafeCount(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "bigint") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.max(0, Math.round(numeric));
}

async function readApproximateTableCount(tableName: string): Promise<number | null> {
  const now = Date.now();
  const cached = approximateCountCache.get(tableName);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const inFlight = approximateCountInFlight.get(tableName);
  if (inFlight) {
    return inFlight;
  }

  const pending = prisma.$queryRawUnsafe<Array<{ tableRows: bigint | number | null }>>(
    `
      SELECT TABLE_ROWS AS tableRows
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      LIMIT 1
    `,
    tableName,
  )
    .then((rows) => {
      const value = toSafeCount(rows[0]?.tableRows ?? null);
      if (value === null) {
        return null;
      }

      approximateCountCache.set(tableName, {
        value,
        expiresAt: Date.now() + INTERACTIVE_TABLE_COUNT_APPROX_TTL_MS,
      });

      return value;
    })
    .catch(() => null)
    .finally(() => {
      approximateCountInFlight.delete(tableName);
    });

  approximateCountInFlight.set(tableName, pending);
  return pending;
}

function refreshExactCount(cacheKey: string, exactCount: () => Promise<number>, fallback: number): Promise<number> {
  return refreshExactCountWithTtl(cacheKey, exactCount, fallback, INTERACTIVE_TABLE_COUNT_EXACT_TTL_MS);
}

function refreshExactCountWithTtl(
  cacheKey: string,
  exactCount: () => Promise<number>,
  fallback: number,
  ttlMs: number,
): Promise<number> {
  const inFlight = exactCountInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const pending = exactCount()
    .then((value) => {
      const safe = toSafeCount(value);
      const resolved = safe === null ? fallback : safe;
      exactCountCache.set(cacheKey, {
        value: resolved,
        expiresAt: Date.now() + ttlMs,
      });
      return resolved;
    })
    .catch(() => {
      const stale = exactCountCache.get(cacheKey);
      if (stale) {
        return stale.value;
      }
      return fallback;
    })
    .finally(() => {
      exactCountInFlight.delete(cacheKey);
    });

  exactCountInFlight.set(cacheKey, pending);
  return pending;
}

export async function getInteractiveTableCount(options: {
  cacheKey: string;
  tableName: string;
  fallback: number;
  exactCount: () => Promise<number>;
  exactTtlMs?: number;
}): Promise<number> {
  const { cacheKey, tableName, fallback, exactCount, exactTtlMs } = options;
  const resolvedExactTtlMs = Math.max(5_000, Number(exactTtlMs ?? INTERACTIVE_TABLE_COUNT_EXACT_TTL_MS));

  const now = Date.now();
  const exactCached = exactCountCache.get(cacheKey);
  if (exactCached && exactCached.expiresAt > now) {
    return exactCached.value;
  }

  if (exactCached) {
    void refreshExactCountWithTtl(cacheKey, exactCount, fallback, resolvedExactTtlMs);
    return exactCached.value;
  }

  const approx = await readApproximateTableCount(tableName);
  if (approx !== null) {
    void refreshExactCountWithTtl(cacheKey, exactCount, fallback, resolvedExactTtlMs);
    return approx;
  }

  return refreshExactCountWithTtl(cacheKey, exactCount, fallback, resolvedExactTtlMs);
}

export function clearInteractiveTableCountCache() {
  exactCountCache.clear();
  approximateCountCache.clear();
  exactCountInFlight.clear();
  approximateCountInFlight.clear();
}
