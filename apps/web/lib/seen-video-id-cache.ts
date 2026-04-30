export type SeenVideoIdCache = {
  get: (userId: number) => Set<string> | undefined;
  set: (userId: number, ids: Set<string>) => void;
  add: (userId: number, videoId: string) => void;
  clear: () => void;
};

export function createSeenVideoIdCache(ttlMs: number, options?: { maxEntries?: number }): SeenVideoIdCache {
  const safeTtlMs = Math.max(0, Math.floor(ttlMs));
  const safeMaxEntries = Math.max(1, Math.floor(Number(options?.maxEntries ?? 1_500)));
  const entries = new Map<number, { expiresAt: number; ids: Set<string> }>();

  const cloneIds = (ids: Set<string>) => new Set(ids);

  const pruneOldestEntries = () => {
    while (entries.size > safeMaxEntries) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }

      entries.delete(oldestKey);
    }
  };

  const get = (userId: number) => {
    const cached = entries.get(userId);
    if (!cached) {
      return undefined;
    }

    if (cached.expiresAt <= Date.now()) {
      entries.delete(userId);
      return undefined;
    }

    return cloneIds(cached.ids);
  };

  const set = (userId: number, ids: Set<string>) => {
    entries.delete(userId);
    entries.set(userId, {
      expiresAt: Date.now() + safeTtlMs,
      ids: cloneIds(ids),
    });
    pruneOldestEntries();
  };

  const add = (userId: number, videoId: string) => {
    const cached = entries.get(userId);
    if (!cached || cached.expiresAt <= Date.now()) {
      entries.delete(userId);
      return;
    }

    const next = cloneIds(cached.ids);
    next.add(videoId);
    set(userId, next);
  };

  return {
    get,
    set,
    add,
    clear: () => entries.clear(),
  };
}
