export const AUTOPLAY_MIX_KEYS = ["top100", "favourites", "newest", "random"] as const;

export type AutoplayMixKey = (typeof AUTOPLAY_MIX_KEYS)[number];

export type AutoplayMixSettings = Record<AutoplayMixKey, number>;

export const DEFAULT_AUTOPLAY_MIX: AutoplayMixSettings = {
  top100: 25,
  favourites: 25,
  newest: 25,
  random: 25,
};

export type PlayerPreferencePayload = {
  autoplayEnabled: boolean | null;
  volume: number | null;
  autoplayMix: AutoplayMixSettings;
  autoplayGenreFilters: string[];
};

function clampPercentage(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function allocatePercentages(values: Record<AutoplayMixKey, number>, total = 100): AutoplayMixSettings {
  const entries = AUTOPLAY_MIX_KEYS.map((key) => {
    const raw = Math.max(0, values[key]);
    const floor = Math.floor(raw);
    return { key, raw, floor, remainder: raw - floor };
  });

  const floorSum = entries.reduce((sum, entry) => sum + entry.floor, 0);
  let remaining = Math.max(0, total - floorSum);

  entries.sort((a, b) => b.remainder - a.remainder);

  const allocated = new Map<AutoplayMixKey, number>();
  for (const entry of entries) {
    const add = remaining > 0 ? 1 : 0;
    allocated.set(entry.key, entry.floor + add);
    if (remaining > 0) {
      remaining -= 1;
    }
  }

  // Any overflow from floors > total is trimmed from largest floors first.
  let overflow = Math.max(0, floorSum - total);
  if (overflow > 0) {
    const byFloor = [...entries].sort((a, b) => b.floor - a.floor);
    for (const entry of byFloor) {
      if (overflow <= 0) {
        break;
      }

      const current = allocated.get(entry.key) ?? 0;
      const deduction = Math.min(current, overflow);
      allocated.set(entry.key, current - deduction);
      overflow -= deduction;
    }
  }

  return {
    top100: allocated.get("top100") ?? 0,
    favourites: allocated.get("favourites") ?? 0,
    newest: allocated.get("newest") ?? 0,
    random: allocated.get("random") ?? 0,
  };
}

export function normalizeAutoplayMix(input: Partial<Record<AutoplayMixKey, unknown>> | null | undefined): AutoplayMixSettings {
  if (!input) {
    return { ...DEFAULT_AUTOPLAY_MIX };
  }

  const numeric = {
    top100: clampPercentage(input.top100),
    favourites: clampPercentage(input.favourites),
    newest: clampPercentage(input.newest),
    random: clampPercentage(input.random),
  };

  const sum = numeric.top100 + numeric.favourites + numeric.newest + numeric.random;
  if (sum <= 0) {
    return { ...DEFAULT_AUTOPLAY_MIX };
  }

  const scaled = {
    top100: (numeric.top100 / sum) * 100,
    favourites: (numeric.favourites / sum) * 100,
    newest: (numeric.newest / sum) * 100,
    random: (numeric.random / sum) * 100,
  };

  return allocatePercentages(scaled, 100);
}

export function rebalanceAutoplayMix(current: AutoplayMixSettings, updatedKey: AutoplayMixKey, updatedValue: number): AutoplayMixSettings {
  const clampedUpdated = clampPercentage(updatedValue);
  const otherKeys = AUTOPLAY_MIX_KEYS.filter((key) => key !== updatedKey);
  const remaining = 100 - clampedUpdated;

  const currentOthers = otherKeys.map((key) => Math.max(0, current[key]));
  const currentOtherSum = currentOthers.reduce((sum, value) => sum + value, 0);

  const nextRaw: Record<AutoplayMixKey, number> = {
    top100: current.top100,
    favourites: current.favourites,
    newest: current.newest,
    random: current.random,
  };
  nextRaw[updatedKey] = clampedUpdated;

  if (remaining <= 0) {
    for (const key of otherKeys) {
      nextRaw[key] = 0;
    }
    return normalizeAutoplayMix(nextRaw);
  }

  if (currentOtherSum <= 0) {
    const evenShare = remaining / otherKeys.length;
    for (const key of otherKeys) {
      nextRaw[key] = evenShare;
    }
    return normalizeAutoplayMix(nextRaw);
  }

  for (const key of otherKeys) {
    nextRaw[key] = (Math.max(0, current[key]) / currentOtherSum) * remaining;
  }

  return normalizeAutoplayMix(nextRaw);
}

export function normalizeAutoplayGenreFilters(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const normalized = input
    .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
    .filter((value) => value.length > 0)
    .slice(0, 24);

  return [...new Set(normalized)];
}

export function doesVideoMatchAutoplayGenres(videoGenre: string | null | undefined, allowedGenres: string[]): boolean {
  if (allowedGenres.length === 0) {
    return true;
  }

  const blob = (videoGenre ?? "").trim().toLowerCase();
  if (!blob) {
    return false;
  }

  return allowedGenres.some((genre) => blob.includes(genre));
}
