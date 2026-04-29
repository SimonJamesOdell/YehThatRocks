type WatchNextSourceLabels = {
  isFavouriteSource?: boolean;
  isTop100Source?: boolean;
  isNewSource?: boolean;
  sourceLabel?: string;
};

export function shuffleVideos<T>(rows: T[]) {
  const shuffled = [...rows];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[randomIndex];
    shuffled[randomIndex] = current;
  }

  return shuffled;
}

export function uniqueVideosById<T extends { id: string }>(rows: T[]) {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const row of rows) {
    if (seen.has(row.id)) {
      continue;
    }

    seen.add(row.id);
    unique.push(row);
  }

  return unique;
}

export function blendRelatedWithFavourites<T extends { id: string }>(
  baseVideos: T[],
  favouriteVideos: T[],
  currentVideoId: string,
  favouriteRatio: number,
) {
  if (favouriteVideos.length === 0 || favouriteRatio <= 0) {
    return uniqueVideosById(baseVideos).filter((video) => video.id !== currentVideoId);
  }

  const preferred = uniqueVideosById(favouriteVideos).filter((video) => video.id !== currentVideoId);
  if (preferred.length === 0) {
    return uniqueVideosById(baseVideos).filter((video) => video.id !== currentVideoId);
  }

  const preferredIds = new Set(preferred.map((video) => video.id));
  const discovery = uniqueVideosById(baseVideos).filter(
    (video) => video.id !== currentVideoId && !preferredIds.has(video.id),
  );

  const blend = Math.max(0.05, Math.min(0.95, favouriteRatio));
  const nonPreferredPerPreferred = Math.max(1, Math.round((1 - blend) / blend));
  let nonPreferredSincePreferred = 0;
  let preferredIndex = 0;
  let discoveryIndex = 0;
  const mixed: T[] = [];

  while (preferredIndex < preferred.length || discoveryIndex < discovery.length) {
    const shouldTakePreferred =
      preferredIndex < preferred.length
      && (nonPreferredSincePreferred >= nonPreferredPerPreferred || discoveryIndex >= discovery.length);

    if (shouldTakePreferred) {
      mixed.push(preferred[preferredIndex]);
      preferredIndex += 1;
      nonPreferredSincePreferred = 0;
      continue;
    }

    if (discoveryIndex < discovery.length) {
      mixed.push(discovery[discoveryIndex]);
      discoveryIndex += 1;
      nonPreferredSincePreferred += 1;
      continue;
    }

    if (preferredIndex < preferred.length) {
      mixed.push(preferred[preferredIndex]);
      preferredIndex += 1;
      nonPreferredSincePreferred = 0;
    }
  }

  return mixed;
}

export function interleaveVideoBuckets<T extends { id: string }>(buckets: T[][]) {
  const queues = buckets.map((bucket) => [...bucket]);
  const mixed: T[] = [];

  while (queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next) {
        mixed.push(next);
      }
    }
  }

  return mixed;
}

export function limitFavouritesInHead<T extends { id: string }>(
  rows: T[],
  favouriteIds: Set<string>,
  headWindow: number,
  maxFavouritesInHead: number,
) {
  if (rows.length <= 1 || favouriteIds.size === 0 || headWindow <= 0) {
    return rows;
  }

  const early: T[] = [];
  const deferredFavourites: T[] = [];
  const tail: T[] = [];
  let favouritesInHead = 0;

  for (const row of rows) {
    if (early.length < headWindow) {
      const isFavourite = favouriteIds.has(row.id);
      if (isFavourite && favouritesInHead >= maxFavouritesInHead) {
        deferredFavourites.push(row);
        continue;
      }

      early.push(row);
      if (isFavourite) {
        favouritesInHead += 1;
      }
      continue;
    }

    tail.push(row);
  }

  return [...early, ...deferredFavourites, ...tail];
}

export function injectSparseFavourites<T extends { id: string }>(
  baseVideos: T[],
  favouriteVideos: T[],
  currentVideoId: string,
  insertInterval: number,
) {
  if (favouriteVideos.length === 0) {
    return uniqueVideosById(baseVideos).filter((video) => video.id !== currentVideoId);
  }

  const base = uniqueVideosById(baseVideos).filter((video) => video.id !== currentVideoId);
  const baseIds = new Set(base.map((video) => video.id));
  const favourites = uniqueVideosById(favouriteVideos).filter(
    (video) => video.id !== currentVideoId && !baseIds.has(video.id),
  );

  if (base.length === 0) {
    return favourites;
  }

  if (favourites.length === 0) {
    return base;
  }

  const safeInterval = Math.max(4, Math.floor(insertInterval));
  const mixed: T[] = [];
  let favouriteIndex = 0;

  for (let index = 0; index < base.length; index += 1) {
    mixed.push(base[index]);

    const shouldInjectFavourite = (index + 1) % safeInterval === 0;
    if (shouldInjectFavourite && favouriteIndex < favourites.length) {
      mixed.push(favourites[favouriteIndex]);
      favouriteIndex += 1;
    }
  }

  while (favouriteIndex < favourites.length) {
    mixed.push(favourites[favouriteIndex]);
    favouriteIndex += 1;
  }

  return mixed;
}

export function hashSeed(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function createSeededRandom(seedInput: string) {
  let state = hashSeed(seedInput) || 0x9e3779b9;

  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleWithRandom<T>(rows: T[], random: () => number) {
  const shuffled = [...rows];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(random() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[randomIndex];
    shuffled[randomIndex] = current;
  }

  return shuffled;
}

export function pickBatchSourceVideos<T extends { id: string }>(params: {
  source: T[];
  count: number;
  blockedIds: Set<string>;
  random: () => number;
  labels?: WatchNextSourceLabels;
}) {
  const picked: Array<T & WatchNextSourceLabels> = [];
  const shuffledSource = shuffleWithRandom(params.source, params.random);

  for (const video of shuffledSource) {
    if (params.blockedIds.has(video.id)) {
      continue;
    }

    params.blockedIds.add(video.id);
    picked.push({ ...video, ...params.labels });

    if (picked.length >= params.count) {
      break;
    }
  }

  return picked;
}
