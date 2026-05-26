import { getGenreSlug, type GenreCard } from "@/lib/catalog-data-utils";

type GenreBucket = {
  label: string;
  terms: string[];
};

export const TOP_LEVEL_GENRE_BUCKETS: readonly GenreBucket[] = [
  {
    label: "Rock & Alternative",
    terms: [
      "heavy rock",
      "hard rock",
      "boogie rock",
      "blues rock",
      "classic rock",
      "arena rock",
      "rock",
      "alternative rock",
      "britpop",
      "indie rock",
      "art rock",
      "folk rock",
      "country rock",
      "southern rock",
      "garage rock",
      "psychedelic rock",
      "space rock",
      "noise rock",
      "gothic rock",
      "post punk",
      "new wave",
      "grunge",
      "post grunge",
      "shoegaze",
      "dream pop",
      "post rock",
      "math rock",
      "surf rock",
    ],
  },
  {
    label: "Punk & Hardcore",
    terms: [
      "punk",
      "punk rock",
      "hardcore punk",
      "post hardcore",
      "melodic hardcore",
      "skate punk",
      "pop punk",
      "anarcho punk",
      "crust punk",
      "d beat",
      "crossover thrash",
      "powerviolence",
      "screamo",
      "emo",
    ],
  },
  {
    label: "Classic and Symphonic Metal",
    terms: [
      "heavy metal",
      "traditional heavy metal",
      "nwobhm",
      "new wave of british heavy metal",
      "glam metal",
      "hair metal",
      "epic metal",
      "neoclassical metal",
      "symphonic metal",
    ],
  },
  {
    label: "Thrash & Power Metal",
    terms: [
      "thrash metal",
      "blackened thrash metal",
      "crossover thrash",
      "speed metal",
      "power metal",
      "groove metal",
    ],
  },
  {
    label: "Black and Death Metal",
    terms: [
      "black metal",
      "atmospheric black metal",
      "symphonic black metal",
      "melodic black metal",
      "depressive suicidal black metal",
      "war metal",
      "death metal",
      "melodic death metal",
      "technical death metal",
      "brutal death metal",
      "old school death metal",
      "grindcore",
      "deathgrind",
      "goregrind",
    ],
  },
  {
    label: "Doom & Sludge",
    terms: [
      "doom metal",
      "traditional doom metal",
      "epic doom metal",
      "funeral doom",
      "death doom",
      "stoner doom",
      "sludge metal",
      "post doom",
      "stoner metal",
      "stoner rock",
      "drone metal",
      "drone doom",
    ],
  },
  {
    label: "Nu-metal & Metalcore",
    terms: [
      "nu metal",
      "metalcore",
      "melodic metalcore",
      "deathcore",
      "alternative metal",
      "rap metal",
      "electronicore",
      "trancecore",
    ],
  },
  {
    label: "Progressive & Experimental",
    terms: [
      "progressive metal",
      "progressive rock",
      "avant garde metal",
      "experimental metal",
      "technical metal",
      "post metal",
      "post black metal",
      "blackgaze",
      "atmospheric metal",
      "djent",
      "progressive metalcore",
      "mathcore",
      "industrial rock",
      "industrial metal",
    ],
  },
];

export const TOP_LEVEL_GENRE_BUCKET_LABELS = TOP_LEVEL_GENRE_BUCKETS.map((bucket) => bucket.label);

const GENRE_ALIAS_TO_CANONICAL = new Map<string, string>([
  ["death", "death metal"],
  ["speed", "speed metal"],
  ["power", "power metal"],
  ["technical thrash", "thrash metal"],
  ["melodic death", "melodic death metal"],
  ["progressive", "progressive metal"],
  ["technical speed", "technical speed metal"],
  ["metal", "heavy metal"],
  ["occult", "black metal"],
  ["crossover", "crossover thrash"],
]);

function normalizeGenreToken(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalizeGenreLabel(input: string): string {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    return "";
  }

  const normalized = normalizeGenreToken(trimmedInput);
  const canonical = GENRE_ALIAS_TO_CANONICAL.get(normalized);
  return canonical ?? trimmedInput;
}

function tokenMatchesTerm(normalizedToken: string, normalizedTerm: string) {
  return normalizedToken === normalizedTerm
    || normalizedToken.startsWith(`${normalizedTerm} `)
    || normalizedToken.endsWith(` ${normalizedTerm}`)
    || normalizedToken.includes(` ${normalizedTerm} `);
}

export function resolveAllTopLevelGenreBuckets(input: string): string[] {
  const normalizedInput = normalizeGenreToken(input);
  if (!normalizedInput) {
    return [];
  }

  const hasRockToken = tokenMatchesTerm(normalizedInput, "rock");
  const hasMetalToken = tokenMatchesTerm(normalizedInput, "metal");
  if (hasRockToken && hasMetalToken) {
    const hasSpecificSubgenreSignal = TOP_LEVEL_GENRE_BUCKETS.some((bucket) =>
      bucket.terms.some((term) => {
        const normalizedTerm = normalizeGenreToken(term);
        if (normalizedTerm === "rock") {
          return false;
        }

        return tokenMatchesTerm(normalizedInput, normalizedTerm);
      }),
    );

    // Generic mixed labels like "Rock / Metal" are too broad to bucket reliably.
    if (!hasSpecificSubgenreSignal) {
      return [];
    }
  }

  const matchingLabels = TOP_LEVEL_GENRE_BUCKETS
    .filter((bucket) => normalizeGenreToken(bucket.label) === normalizedInput)
    .map((bucket) => bucket.label);

  if (matchingLabels.length > 0) {
    return matchingLabels;
  }

  return TOP_LEVEL_GENRE_BUCKETS
    .filter((bucket) =>
      bucket.terms.some((term) => {
        const normalizedTerm = normalizeGenreToken(term);
        return tokenMatchesTerm(normalizedInput, normalizedTerm);
      }),
    )
    .map((bucket) => bucket.label);
}

export function resolveTopLevelGenreBucket(input: string): string | null {
  const matches = resolveAllTopLevelGenreBuckets(input);
  return matches[0] ?? null;
}

export function getTopLevelGenreBucketBySlug(slug: string): string | null {
  if (slug === "classic-metal") {
    return "Classic and Symphonic Metal";
  }

  if (slug === "modern-metal") {
    return "Nu-metal & Metalcore";
  }

  if (slug === "black-metal") {
    return "Black and Death Metal";
  }

  for (const bucket of TOP_LEVEL_GENRE_BUCKETS) {
    if (getGenreSlug(bucket.label) === slug) {
      return bucket.label;
    }
  }

  return null;
}

export function getBucketTermsForGenreSelection(selection: string): string[] {
  const resolvedBucket = resolveTopLevelGenreBucket(selection);
  if (!resolvedBucket) {
    return [selection];
  }

  const bucket = TOP_LEVEL_GENRE_BUCKETS.find((entry) => entry.label === resolvedBucket);
  if (!bucket) {
    return [selection];
  }

  return [...new Set([bucket.label, ...bucket.terms])];
}

export function collateGenreCardsToTopLevelBuckets(cards: GenreCard[]): GenreCard[] {
  const bucketMap = new Map<string, GenreCard>();

  for (const card of cards) {
    const bucketLabel = resolveTopLevelGenreBucket(card.genre) ?? "Rock & Alternative";
    const existing = bucketMap.get(bucketLabel);

    if (!existing) {
      bucketMap.set(bucketLabel, {
        genre: bucketLabel,
        previewVideoId: card.previewVideoId,
        artistCount: Number(card.artistCount ?? 0),
      });
      continue;
    }

    existing.artistCount += Number(card.artistCount ?? 0);
    if (!existing.previewVideoId && card.previewVideoId) {
      existing.previewVideoId = card.previewVideoId;
    }
  }

  return TOP_LEVEL_GENRE_BUCKETS
    .map((bucket) => bucketMap.get(bucket.label))
    .filter((entry): entry is GenreCard => Boolean(entry));
}
