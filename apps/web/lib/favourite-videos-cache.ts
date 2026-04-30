import type { VideoRecord } from "@/lib/catalog";

export type FavouriteVideosCache = {
  get: (userId: number) => VideoRecord[] | undefined;
  set: (userId: number, videos: VideoRecord[]) => void;
  delete: (userId: number) => void;
  clear: () => void;
};

export function createFavouriteVideosCache(ttlMs: number, options?: { maxEntries?: number }): FavouriteVideosCache {
  const safeTtlMs = Math.max(0, Math.floor(ttlMs));
  const safeMaxEntries = Math.max(1, Math.floor(Number(options?.maxEntries ?? 1_500)));
  const entries = new Map<number, { expiresAt: number; videos: VideoRecord[] }>();

  const cloneVideos = (videos: VideoRecord[]) => videos.map((video) => ({ ...video }));

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

    return cloneVideos(cached.videos);
  };

  const set = (userId: number, videos: VideoRecord[]) => {
    entries.delete(userId);
    entries.set(userId, {
      expiresAt: Date.now() + safeTtlMs,
      videos: cloneVideos(videos),
    });
    pruneOldestEntries();
  };

  return {
    get,
    set,
    delete: (userId: number) => entries.delete(userId),
    clear: () => entries.clear(),
  };
}
