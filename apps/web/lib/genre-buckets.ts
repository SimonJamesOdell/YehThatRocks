import { getGenreSlug, type GenreCard } from "@/lib/catalog-data-utils";

type GenreBucket = {
  label: string;
  terms: string[];
};

export const TOP_LEVEL_GENRE_BUCKETS: readonly GenreBucket[] = [
  {
    label: "Rock & Alternative",
    terms: ["rock", "grunge", "shoegaze", "post rock"],
  },
  {
    label: "Punk & Hardcore",
    terms: ["punk", "post hardcore", "hardcore", "screamo"],
  },
  {
    label: "Classic Metal",
    terms: ["heavy", "nwobhm", "glam", "power", "symphonic"],
  },
  {
    label: "Extreme Metal",
    terms: ["deathcore", "death", "black", "thrash", "grind"],
  },
  {
    label: "Doom & Sludge",
    terms: ["post doom", "doom", "sludge", "stoner"],
  },
  {
    label: "Modern Metal",
    terms: ["metalcore", "djent", "groove", "nu metal", "mathcore"],
  },
  {
    label: "Progressive & Experimental",
    terms: ["post black", "post metal", "progressive", "industrial"],
  },
];

function normalizeGenreToken(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenMatchesTerm(normalizedToken: string, normalizedTerm: string) {
  return normalizedToken === normalizedTerm
    || normalizedToken.startsWith(`${normalizedTerm} `)
    || normalizedToken.endsWith(` ${normalizedTerm}`)
    || normalizedToken.includes(` ${normalizedTerm} `);
}

export function resolveTopLevelGenreBucket(input: string): string | null {
  const normalizedInput = normalizeGenreToken(input);
  if (!normalizedInput) {
    return null;
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
      return null;
    }
  }

  for (const bucket of TOP_LEVEL_GENRE_BUCKETS) {
    const normalizedLabel = normalizeGenreToken(bucket.label);
    if (normalizedInput === normalizedLabel) {
      return bucket.label;
    }
  }

  for (const bucket of TOP_LEVEL_GENRE_BUCKETS) {
    for (const term of bucket.terms) {
      const normalizedTerm = normalizeGenreToken(term);
      if (tokenMatchesTerm(normalizedInput, normalizedTerm)) {
        return bucket.label;
      }
    }
  }

  return null;
}

export function getTopLevelGenreBucketBySlug(slug: string): string | null {
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

  return [...bucket.terms];
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
