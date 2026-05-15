export type ServerAuthCacheState<T> = {
  expiresAt: number;
  value: T;
};

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function readPositiveIntEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return clamp(Math.floor(parsed), min, max);
}

export function pruneExpiringCacheEntries<T>(
  entries: Map<string, ServerAuthCacheState<T>>,
  now = Date.now(),
) {
  for (const [key, entry] of entries.entries()) {
    if (entry.expiresAt <= now) {
      entries.delete(key);
    }
  }
}

export function pruneCacheToMaxEntries<T>(
  entries: Map<string, ServerAuthCacheState<T>>,
  maxEntries: number,
) {
  if (maxEntries <= 0) {
    entries.clear();
    return;
  }

  while (entries.size > maxEntries) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    entries.delete(oldestKey);
  }
}

export function setCacheEntry<T>(
  entries: Map<string, ServerAuthCacheState<T>>,
  key: string,
  value: T,
  ttlMs: number,
  maxEntries: number,
  now = Date.now(),
) {
  entries.delete(key);
  entries.set(key, {
    value,
    expiresAt: now + ttlMs,
  });
  pruneCacheToMaxEntries(entries, maxEntries);
}

export function getCacheEntry<T>(
  entries: Map<string, ServerAuthCacheState<T>>,
  key: string,
  now = Date.now(),
): T | undefined {
  const cached = entries.get(key);
  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= now) {
    entries.delete(key);
    return undefined;
  }

  // Reinsert to keep LRU-like behavior by access recency.
  entries.delete(key);
  entries.set(key, cached);
  return cached.value;
}
