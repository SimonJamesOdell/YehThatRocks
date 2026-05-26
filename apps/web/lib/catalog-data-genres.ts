/**
 * catalog-data-genres.ts
 * Genre / category domain: genre list, genre cards, artists-by-genre, videos-by-genre.
 */

import { prisma } from "@/lib/db";
import { BoundedMap } from "@/lib/bounded-map";
import { slugifyArtistName } from "@/lib/artist-routing";
import type { ArtistRecord, VideoRecord } from "@/lib/catalog";
import {
  type CategoryArtistCard,
  dedupeRankedRows,
  escapeSqlIdentifier,
  getGenreSlug,
  hasDatabaseUrl,
  mapArtist,
  mapVideo,
  normalizeArtistKey,
  normalizeYouTubeVideoId,
  requireDatabaseUrl,
  withSoftTimeout,
  type GenreCard,
  type RankedVideoRow,
} from "@/lib/catalog-data-utils";
import {
  AVAILABLE_SITE_VIDEOS_EXISTS_CLAUSE,
  AVAILABLE_SITE_VIDEOS_JOIN,
  getArtistColumnMap,
  getArtistNameNormalizationExpr,
  getVideoArtistNormalizationColumn,
  getVideoArtistNormalizationExpr,
  getVideoArtistNormalizationIndexHintClause,
  hasGenreAllColumn,
  hasVideoGenreColumn,
  hasVideoTitleFulltextIndex,
} from "@/lib/catalog-data-db";
import {
  collateGenreCardsToTopLevelBuckets,
  getBucketTermsForGenreSelection,
  getTopLevelGenreBucketBySlug,
  resolveTopLevelGenreBucket,
  TOP_LEVEL_GENRE_BUCKETS,
} from "@/lib/genre-buckets";

// ── Constants ─────────────────────────────────────────────────────────────────

const GENRE_RESULTS_CACHE_TTL_MS = 5 * 60 * 1000;
const GENRE_CARDS_CACHE_TTL_MS = 30 * 1000;
const CATEGORY_QUERY_TIMEOUT_MS = 2_500;
const CATEGORY_QUERY_DB_MAX_EXECUTION_MS = 1_200;
const CATEGORY_ARTIST_THUMB_TABLE_CACHE_TTL_MS = 60_000;
const CATEGORY_BUCKET_RUNTIME_CACHE_TABLE_CACHE_TTL_MS = 60_000;
const CATEGORY_BUCKET_RUNTIME_CACHE_STALE_MS = 6 * 60 * 60 * 1000;
const CATEGORY_ARTIST_RUNTIME_CACHE_TABLE_CACHE_TTL_MS = 60_000;
const CATEGORY_ARTIST_RUNTIME_CACHE_STALE_MS = 6 * 60 * 60 * 1000;
const CATEGORY_ARTIST_RUNTIME_CACHE_REBUILD_LIMIT = 2_000;
const GENRE_ARTIST_SEED_CACHE_TTL_MS = 2 * 60 * 1000;
const GENRE_CACHE_MAX_ENTRIES = Math.max(
  100,
  Math.min(2_000, Number(process.env.GENRE_CACHE_MAX_ENTRIES || "600")),
);

// ── Caches ────────────────────────────────────────────────────────────────────

const genreArtistsCache = new BoundedMap<string, { expiresAt: number; artists: ArtistRecord[] }>(GENRE_CACHE_MAX_ENTRIES);
const genreVideosCache = new BoundedMap<string, { expiresAt: number; videos: VideoRecord[] }>(GENRE_CACHE_MAX_ENTRIES);
const genreVideosInFlight = new BoundedMap<string, Promise<VideoRecord[]>>(GENRE_CACHE_MAX_ENTRIES);
const genreArtistSeedCache = new BoundedMap<string, { expiresAt: number; artistNames: string[] }>(GENRE_CACHE_MAX_ENTRIES);
let genreCardsCache: { expiresAt: number; cards: GenreCard[] } | undefined;
let genreCardsInFlight: Promise<GenreCard[]> | undefined;
let genreListCache: { expiresAt: number; genres: string[] } | undefined;
const genreArtistCountCache = new BoundedMap<string, { expiresAt: number; count: number }>(GENRE_CACHE_MAX_ENTRIES);
let categoryArtistThumbTableAvailableCache: { checkedAt: number; available: boolean } | undefined;
let categoryBucketRuntimeCacheTableAvailableCache: { checkedAt: number; available: boolean } | undefined;
let categoryArtistRuntimeCacheTableAvailableCache: { checkedAt: number; available: boolean } | undefined;
const categoryArtistRuntimeCacheRebuildInFlight = new Map<string, Promise<void>>();

const GENRE_ARTIST_COUNT_CACHE_TTL_MS = 10 * 60 * 1000;

async function hydrateGenreArtistCounts(cards: GenreCard[]): Promise<GenreCard[]> {
  if (cards.length === 0) {
    return cards;
  }

  const now = Date.now();
  const countByGenre = new Map<string, number>();
  const missingCards: GenreCard[] = [];

  for (const card of cards) {
    const key = card.genre.trim().toLowerCase();
    const cached = genreArtistCountCache.get(key);
    if (cached && cached.expiresAt > now) {
      countByGenre.set(key, cached.count);
      continue;
    }
    missingCards.push(card);
  }

  for (const card of missingCards) {
    const key = card.genre.trim().toLowerCase();
    const artists = await getCategoryArtistsByGenre(card.genre, { offset: 0, limit: 2_000 });
    const count = artists.length;
    countByGenre.set(key, count);
    genreArtistCountCache.set(key, { expiresAt: now + GENRE_ARTIST_COUNT_CACHE_TTL_MS, count });
  }

  return cards.map((card) => ({
    ...card,
    artistCount: countByGenre.get(card.genre.trim().toLowerCase()) ?? 0,
  }));
}

async function attachArtistCountsToGenreCards(cards: GenreCard[]): Promise<GenreCard[]> {
  if (cards.length === 0) {
    return cards;
  }

  try {
    return await hydrateGenreArtistCounts(cards);
  } catch (error) {
    console.error("[catalog-data-genres] attachArtistCountsToGenreCards failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return cards.map((card) => ({ ...card, artistCount: 0 }));
  }
}

function getCategoryArtistNormalizationExpr(alias: string, normalizedColumn: string | null) {
  const parsedArtistRef = `${alias}.parsedArtist`;
  const channelTitleRef = `${alias}.channelTitle`;

  if (normalizedColumn) {
    const normalizedRef = `${alias}.${escapeSqlIdentifier(normalizedColumn)}`;
    return `LOWER(TRIM(COALESCE(NULLIF(${normalizedRef}, ''), NULLIF(${parsedArtistRef}, ''), NULLIF(${channelTitleRef}, ''))))`;
  }

  return `LOWER(TRIM(COALESCE(NULLIF(${parsedArtistRef}, ''), NULLIF(${channelTitleRef}, ''))))`;
}

async function hasCategoryArtistThumbnailTable() {
  const now = Date.now();
  if (
    categoryArtistThumbTableAvailableCache?.available
    && categoryArtistThumbTableAvailableCache.checkedAt + CATEGORY_ARTIST_THUMB_TABLE_CACHE_TTL_MS > now
  ) {
    return true;
  }

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ tableName?: string }>>(
      "SHOW TABLES LIKE 'category_artist_thumbnails'",
    );
    const available = rows.length > 0;
    categoryArtistThumbTableAvailableCache = available
      ? { checkedAt: now, available: true }
      : undefined;
    return available;
  } catch {
    categoryArtistThumbTableAvailableCache = undefined;
    return false;
  }
}

async function ensureCategoryArtistThumbnailTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS category_artist_thumbnails (
      id BIGINT NOT NULL AUTO_INCREMENT,
      genre_norm VARCHAR(255) NOT NULL,
      artist_key VARCHAR(255) NOT NULL,
      thumbnail_video_id VARCHAR(32) NOT NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uniq_category_artist_thumb (genre_norm, artist_key),
      KEY idx_category_artist_thumb_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  categoryArtistThumbTableAvailableCache = { checkedAt: Date.now(), available: true };
}

async function hasCategoryBucketRuntimeCacheTable() {
  const now = Date.now();
  if (
    categoryBucketRuntimeCacheTableAvailableCache?.available
    && categoryBucketRuntimeCacheTableAvailableCache.checkedAt + CATEGORY_BUCKET_RUNTIME_CACHE_TABLE_CACHE_TTL_MS > now
  ) {
    return true;
  }

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ tableName?: string }>>(
      "SHOW TABLES LIKE 'category_bucket_runtime_cache'",
    );
    const available = rows.length > 0;
    categoryBucketRuntimeCacheTableAvailableCache = available
      ? { checkedAt: now, available: true }
      : undefined;
    return available;
  } catch {
    categoryBucketRuntimeCacheTableAvailableCache = undefined;
    return false;
  }
}

async function ensureCategoryBucketRuntimeCacheTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS category_bucket_runtime_cache (
      bucket_label VARCHAR(255) NOT NULL,
      preview_video_id VARCHAR(32) NULL,
      artist_count INT NOT NULL DEFAULT 0,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (bucket_label),
      KEY idx_category_bucket_runtime_cache_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  categoryBucketRuntimeCacheTableAvailableCache = { checkedAt: Date.now(), available: true };
}

async function hasCategoryArtistRuntimeCacheTable() {
  const now = Date.now();
  if (
    categoryArtistRuntimeCacheTableAvailableCache?.available
    && categoryArtistRuntimeCacheTableAvailableCache.checkedAt + CATEGORY_ARTIST_RUNTIME_CACHE_TABLE_CACHE_TTL_MS > now
  ) {
    return true;
  }

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ tableName?: string }>>(
      "SHOW TABLES LIKE 'category_artist_runtime_cache'",
    );
    const available = rows.length > 0;
    categoryArtistRuntimeCacheTableAvailableCache = available
      ? { checkedAt: now, available: true }
      : undefined;
    return available;
  } catch {
    categoryArtistRuntimeCacheTableAvailableCache = undefined;
    return false;
  }
}

async function ensureCategoryArtistRuntimeCacheTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS category_artist_runtime_cache (
      genre_norm VARCHAR(255) NOT NULL,
      artist_slug VARCHAR(255) NOT NULL,
      artist_name VARCHAR(255) NOT NULL,
      video_count INT NOT NULL DEFAULT 0,
      thumbnail_video_id VARCHAR(32) NULL,
      dominant_genre VARCHAR(255) NULL,
      sort_index INT NOT NULL DEFAULT 0,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (genre_norm, artist_slug),
      KEY idx_category_artist_runtime_sort (genre_norm, sort_index),
      KEY idx_category_artist_runtime_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  categoryArtistRuntimeCacheTableAvailableCache = { checkedAt: Date.now(), available: true };
}

function mapCategoryArtistRows(rows: Array<{
  artistName: string | null;
  thumbnailVideoId: string | null;
  dominantGenre: string | null;
  videoCount: bigint | number;
}>): CategoryArtistCard[] {
  return rows
    .map((row) => {
      const name = (row.artistName ?? "").trim();
      if (!name) {
        return null;
      }

      return {
        name,
        slug: slugifyArtistName(name),
        videoCount: Number(row.videoCount) || 0,
        thumbnailVideoId: (row.thumbnailVideoId ?? "").trim() || null,
        dominantGenre: (row.dominantGenre ?? "").trim() || null,
      } as CategoryArtistCard;
    })
    .filter((row): row is CategoryArtistCard => row !== null);
}

async function getRuntimeCachedCategoryArtistsByGenre(
  normalizedGenre: string,
  options: { offset: number; limit: number },
): Promise<CategoryArtistCard[] | null> {
  if (!hasDatabaseUrl()) {
    return null;
  }

  const tableAvailable = await hasCategoryArtistRuntimeCacheTable();
  if (!tableAvailable) {
    return null;
  }

  const freshnessRows = await prisma.$queryRawUnsafe<Array<{ newestUpdatedAt: Date | null; total: bigint | number }>>(
    `
      SELECT
        MAX(updated_at) AS newestUpdatedAt,
        COUNT(*) AS total
      FROM category_artist_runtime_cache
      WHERE genre_norm = ?
    `,
    normalizedGenre,
  ).catch(() => []);

  const freshness = freshnessRows[0];
  const totalRows = Math.max(0, Number(freshness?.total ?? 0));
  if (totalRows === 0) {
    return null;
  }

  const newestUpdatedAtMs = freshness?.newestUpdatedAt?.getTime() ?? 0;
  if (newestUpdatedAtMs <= 0 || Date.now() - newestUpdatedAtMs > CATEGORY_ARTIST_RUNTIME_CACHE_STALE_MS) {
    return null;
  }

  const rows = await prisma.$queryRawUnsafe<Array<{
    artistName: string | null;
    thumbnailVideoId: string | null;
    dominantGenre: string | null;
    videoCount: bigint | number;
  }>>(
    `
      SELECT
        artist_name AS artistName,
        thumbnail_video_id AS thumbnailVideoId,
        dominant_genre AS dominantGenre,
        video_count AS videoCount
      FROM category_artist_runtime_cache
      WHERE genre_norm = ?
      ORDER BY sort_index ASC
      LIMIT ?
      OFFSET ?
    `,
    normalizedGenre,
    options.limit,
    options.offset,
  ).catch(() => []);

  if (rows.length === 0 && options.offset === 0) {
    return null;
  }

  return mapCategoryArtistRows(rows);
}

async function upsertCategoryArtistRuntimeCacheRows(genreNorm: string, artists: CategoryArtistCard[]) {
  if (!hasDatabaseUrl()) {
    return;
  }

  await ensureCategoryArtistRuntimeCacheTable();

  await prisma.$executeRawUnsafe(
    `DELETE FROM category_artist_runtime_cache WHERE genre_norm = ?`,
    genreNorm,
  );

  if (artists.length === 0) {
    return;
  }

  const chunkSize = 200;
  for (let offset = 0; offset < artists.length; offset += chunkSize) {
    const chunk = artists.slice(offset, offset + chunkSize);
    const valuesClause = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))").join(", ");
    const params: Array<string | number | null> = [];

    for (let index = 0; index < chunk.length; index += 1) {
      const row = chunk[index];
      params.push(
        genreNorm,
        row.slug,
        row.name,
        Math.max(0, Number(row.videoCount || 0)),
        row.thumbnailVideoId || null,
        row.dominantGenre || null,
        offset + index,
      );
    }

    await prisma.$executeRawUnsafe(
      `
        INSERT INTO category_artist_runtime_cache (
          genre_norm,
          artist_slug,
          artist_name,
          video_count,
          thumbnail_video_id,
          dominant_genre,
          sort_index,
          updated_at
        )
        VALUES ${valuesClause}
      `,
      ...params,
    );
  }
}

function scheduleCategoryArtistRuntimeCacheRebuild(genre: string, normalizedGenre: string) {
  if (!normalizedGenre || categoryArtistRuntimeCacheRebuildInFlight.has(normalizedGenre)) {
    return;
  }

  const rebuildPromise = (async () => {
    try {
      const artists = await queryCategoryArtistsByGenreFromVideos(genre, {
        offset: 0,
        limit: CATEGORY_ARTIST_RUNTIME_CACHE_REBUILD_LIMIT,
      });
      await upsertCategoryArtistRuntimeCacheRows(normalizedGenre, artists);
    } catch {
      // best effort only
    }
  })().finally(() => {
    categoryArtistRuntimeCacheRebuildInFlight.delete(normalizedGenre);
  });

  categoryArtistRuntimeCacheRebuildInFlight.set(normalizedGenre, rebuildPromise);
}

async function getPinnedCategoryArtistPreviewsByBucket() {
  const pinnedPreviewByBucket = new Map<string, string>();

  if (!hasDatabaseUrl()) {
    return pinnedPreviewByBucket;
  }

  const hasPinnedCategoryArtistThumbs = await hasCategoryArtistThumbnailTable();
  if (!hasPinnedCategoryArtistThumbs) {
    return pinnedPreviewByBucket;
  }

  const pinnedRows = await prisma.$queryRawUnsafe<Array<{
    genreNorm: string | null;
    thumbnailVideoId: string | null;
  }>>(
    `
      SELECT
        genre_norm AS genreNorm,
        thumbnail_video_id AS thumbnailVideoId
      FROM category_artist_thumbnails
      WHERE thumbnail_video_id IS NOT NULL
        AND TRIM(thumbnail_video_id) <> ''
      ORDER BY updated_at DESC, id DESC
      LIMIT 5000
    `,
  ).catch(() => []);

  for (const row of pinnedRows) {
    const bucketLabel = resolveTopLevelGenreBucket(row.genreNorm ?? "");
    if (!bucketLabel) {
      continue;
    }

    const bucketKey = bucketLabel.trim().toLowerCase();
    if (pinnedPreviewByBucket.has(bucketKey)) {
      continue;
    }

    const normalizedPinnedVideoId = normalizeYouTubeVideoId(row.thumbnailVideoId);
    if (!normalizedPinnedVideoId) {
      continue;
    }

    pinnedPreviewByBucket.set(bucketKey, normalizedPinnedVideoId);
  }

  return pinnedPreviewByBucket;
}

function applyPinnedCategoryArtistPreviews(cards: GenreCard[], pinnedPreviewByBucket: Map<string, string>) {
  if (cards.length === 0 || pinnedPreviewByBucket.size === 0) {
    return cards;
  }

  return cards.map((card) => {
    const bucketKey = card.genre.trim().toLowerCase();
    const pinnedPreviewVideoId = pinnedPreviewByBucket.get(bucketKey);
    if (!pinnedPreviewVideoId || card.previewVideoId === pinnedPreviewVideoId) {
      return card;
    }

    return {
      ...card,
      previewVideoId: pinnedPreviewVideoId,
    };
  });
}

async function upsertCategoryBucketRuntimeCache(cards: GenreCard[]) {
  if (!hasDatabaseUrl() || cards.length === 0) {
    return;
  }

  await ensureCategoryBucketRuntimeCacheTable();

  for (const card of cards) {
    const label = card.genre.trim();
    if (!label) {
      continue;
    }

    await prisma.$executeRawUnsafe(
      `
        INSERT INTO category_bucket_runtime_cache (bucket_label, preview_video_id, artist_count)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          preview_video_id = VALUES(preview_video_id),
          artist_count = VALUES(artist_count),
          updated_at = CURRENT_TIMESTAMP(3)
      `,
      label,
      card.previewVideoId,
      Math.max(0, Number(card.artistCount ?? 0)),
    );
  }
}

async function bootstrapCategoryBucketRuntimeCacheFast(): Promise<GenreCard[] | null> {
  if (!hasDatabaseUrl()) {
    return null;
  }

  await ensureCategoryBucketRuntimeCacheTable();
  const pinnedPreviewByBucket = await getPinnedCategoryArtistPreviewsByBucket();

  const thumbnailRows = await prisma.$queryRawUnsafe<Array<{
    genre: string;
    previewVideoId: string | null;
  }>>(
    `
      SELECT
        v.genre AS genre,
        SUBSTRING_INDEX(
          GROUP_CONCAT(v.videoId ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.id ASC),
          ',', 1
        ) AS previewVideoId
      FROM videos v
      INNER JOIN site_videos sv ON sv.video_id = v.id AND sv.status = 'available'
      WHERE v.genre IS NOT NULL
        AND TRIM(v.genre) <> ''
        AND COALESCE(v.approved, 0) = 1
      GROUP BY v.genre
      ORDER BY v.genre ASC
      LIMIT 4000
    `,
  ).catch(() => []);

  const collatedThumbs = collateGenreCardsToTopLevelBuckets(
    thumbnailRows.map((row) => ({
      genre: row.genre,
      previewVideoId: row.previewVideoId?.trim() || null,
      artistCount: 0,
    })),
  );
  const thumbByBucket = new Map(collatedThumbs.map((card) => [card.genre.trim().toLowerCase(), card.previewVideoId]));

  const bucketArtistCounts = await Promise.all(
    TOP_LEVEL_GENRE_BUCKETS.map(async (bucket) => {
      try {
        const count = await getCategoryArtistCountByGenre(bucket.label);
        return [bucket.label, Math.max(0, Number(count || 0))] as const;
      } catch {
        return [bucket.label, 0] as const;
      }
    }),
  );
  const countByBucket = new Map<string, number>(bucketArtistCounts);

  const cards = applyPinnedCategoryArtistPreviews(TOP_LEVEL_GENRE_BUCKETS.map((bucket) => ({
    genre: bucket.label,
    previewVideoId: pinnedPreviewByBucket.get(bucket.label.trim().toLowerCase())
      ?? thumbByBucket.get(bucket.label.trim().toLowerCase())
      ?? null,
    artistCount: countByBucket.get(bucket.label) ?? 0,
  })), pinnedPreviewByBucket);

  await upsertCategoryBucketRuntimeCache(cards).catch(() => undefined);
  // Remove any stale rows from old/renamed bucket labels that are no longer in TOP_LEVEL_GENRE_BUCKETS.
  // Without this, the bucket-label mismatch check in getRuntimeCachedTopLevelGenreCards will fire
  // on every request (because the table has more rows than expected) and keep triggering bootstraps,
  // making pins impossible to persist.
  const currentBucketLabels = TOP_LEVEL_GENRE_BUCKETS.map((b) => b.label.trim());
  if (currentBucketLabels.length > 0) {
    const placeholders = currentBucketLabels.map(() => "?").join(", ");
    await prisma.$executeRawUnsafe(
      `DELETE FROM category_bucket_runtime_cache WHERE bucket_label NOT IN (${placeholders})`,
      ...currentBucketLabels,
    ).catch(() => undefined);
  }

  return cards;
}

export async function getRuntimeCachedTopLevelGenreCards(): Promise<GenreCard[] | null> {
  if (!hasDatabaseUrl()) {
    return null;
  }

  const pinnedPreviewByBucket = await getPinnedCategoryArtistPreviewsByBucket();

  const tableAvailable = await hasCategoryBucketRuntimeCacheTable();
  if (!tableAvailable) {
    const bootstrapped = await bootstrapCategoryBucketRuntimeCacheFast();
    if (bootstrapped && bootstrapped.length > 0) {
      return bootstrapped;
    }
    return null;
  }

  const rows = await prisma.$queryRawUnsafe<Array<{
    bucketLabel: string;
    previewVideoId: string | null;
    artistCount: number | bigint;
    updatedAt: Date | null;
  }>>(
    `
      SELECT
        bucket_label AS bucketLabel,
        preview_video_id AS previewVideoId,
        artist_count AS artistCount,
        updated_at AS updatedAt
      FROM category_bucket_runtime_cache
      ORDER BY bucket_label ASC
    `,
  );

  if (rows.length === 0) {
    return bootstrapCategoryBucketRuntimeCacheFast();
  }

  const newestUpdatedAtMs = rows.reduce((maxMs, row) => {
    const valueMs = row.updatedAt ? row.updatedAt.getTime() : 0;
    return Math.max(maxMs, Number.isFinite(valueMs) ? valueMs : 0);
  }, 0);

  const expectedBucketLabels = new Set(TOP_LEVEL_GENRE_BUCKETS.map((bucket) => bucket.label.trim().toLowerCase()));
  const cachedBucketLabels = new Set(rows.map((row) => row.bucketLabel.trim().toLowerCase()));
  const hasBucketLabelMismatch = expectedBucketLabels.size !== cachedBucketLabels.size
    || Array.from(expectedBucketLabels).some((label) => !cachedBucketLabels.has(label));

  if (hasBucketLabelMismatch) {
    const refreshed = await bootstrapCategoryBucketRuntimeCacheFast();
    if (refreshed && refreshed.length > 0) {
      return refreshed;
    }
  }

  if (newestUpdatedAtMs <= 0 || Date.now() - newestUpdatedAtMs > CATEGORY_BUCKET_RUNTIME_CACHE_STALE_MS) {
    const refreshed = await bootstrapCategoryBucketRuntimeCacheFast();
    if (refreshed && refreshed.length > 0) {
      return refreshed;
    }
  }

  const cards = TOP_LEVEL_GENRE_BUCKETS.map((bucket) => {
    const cached = rows.find((row) => row.bucketLabel.trim().toLowerCase() === bucket.label.trim().toLowerCase());
    const previewVideoId = cached?.previewVideoId?.trim() || null;
    const artistCount = Math.max(0, Number(cached?.artistCount ?? 0));
    return {
      genre: bucket.label,
      previewVideoId,
      artistCount,
    } as GenreCard;
  });

  const pinnedCards = applyPinnedCategoryArtistPreviews(cards, pinnedPreviewByBucket);

  await upsertCategoryBucketRuntimeCache(pinnedCards).catch(() => undefined);
  return pinnedCards;
}

async function persistTopLevelCategoryPreview(bucketLabel: string, normalizedVideoId: string) {
  const normalizedBucketLabel = bucketLabel.trim();
  if (!normalizedBucketLabel || !normalizedVideoId) {
    return;
  }

  await prisma.genreCard.upsert({
    where: { genre: normalizedBucketLabel },
    update: { thumbnailVideoId: normalizedVideoId },
    create: {
      genre: normalizedBucketLabel,
      thumbnailVideoId: normalizedVideoId,
    },
  }).catch(() => undefined);

  try {
    await ensureCategoryBucketRuntimeCacheTable();

    const existingRows = await prisma.$queryRawUnsafe<Array<{ artistCount: number | bigint }>>(
      `
        SELECT artist_count AS artistCount
        FROM category_bucket_runtime_cache
        WHERE bucket_label = ?
        LIMIT 1
      `,
      normalizedBucketLabel,
    );

    const existingArtistCount = Math.max(0, Number(existingRows[0]?.artistCount ?? 0));

    await prisma.$executeRawUnsafe(
      `
        INSERT INTO category_bucket_runtime_cache (bucket_label, preview_video_id, artist_count)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          preview_video_id = VALUES(preview_video_id),
          updated_at = CURRENT_TIMESTAMP(3)
      `,
      normalizedBucketLabel,
      normalizedVideoId,
      existingArtistCount,
    );
  } catch {
    // Best effort: pin should still persist in genre_cards and category_artist_thumbnails.
  }
}

export async function setTopLevelCategoryThumbnailPin(genre: string, thumbnailVideoId: string) {
  const bucketLabel = resolveTopLevelGenreBucket(genre) ?? genre.trim();
  const normalizedVideoId = normalizeYouTubeVideoId(thumbnailVideoId);

  if (!bucketLabel || !normalizedVideoId) {
    throw new Error("Invalid top-level category thumbnail pin payload");
  }

  await persistTopLevelCategoryPreview(bucketLabel, normalizedVideoId);
  clearGenreCaches();

  return {
    bucketLabel,
    thumbnailVideoId: normalizedVideoId,
  };
}

export async function setCategoryArtistThumbnailPin(genre: string, artistName: string, thumbnailVideoId: string) {
  const normalizedGenre = normalizeGenreTerm(genre);
  const normalizedArtistKey = normalizeArtistKey(artistName);
  const normalizedVideoId = normalizeYouTubeVideoId(thumbnailVideoId);

  if (!normalizedGenre || !normalizedArtistKey || !normalizedVideoId) {
    throw new Error("Invalid category artist thumbnail pin payload");
  }

  await ensureCategoryArtistThumbnailTable();
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO category_artist_thumbnails (genre_norm, artist_key, thumbnail_video_id)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        thumbnail_video_id = VALUES(thumbnail_video_id),
        updated_at = CURRENT_TIMESTAMP(3)
    `,
    normalizedGenre,
    normalizedArtistKey,
    normalizedVideoId,
  );

  const bucketLabel = resolveTopLevelGenreBucket(genre) ?? "Rock & Alternative";
  await persistTopLevelCategoryPreview(bucketLabel, normalizedVideoId);

  const artistRuntimeTableAvailable = await hasCategoryArtistRuntimeCacheTable();
  if (artistRuntimeTableAvailable) {
    await prisma.$executeRawUnsafe(
      `
        UPDATE category_artist_runtime_cache
        SET thumbnail_video_id = ?,
            updated_at = UTC_TIMESTAMP(3)
        WHERE genre_norm = ?
          AND artist_slug = ?
      `,
      normalizedVideoId,
      normalizedGenre,
      slugifyArtistName(artistName),
    ).catch(() => undefined);
  }

  clearGenreCaches();
}

async function queryCategoryArtistsByGenreFromVideos(
  genre: string,
  options: { offset: number; limit: number },
): Promise<CategoryArtistCard[]> {
  const normalizedGenre = normalizeGenreTerm(genre);
  const normalizedGenreTerms = getExpandedGenreTerms(genre);
  const normalizedGenrePattern = buildGenreRegexPattern(normalizedGenreTerms);

  if (!normalizedGenre || normalizedGenreTerms.length === 0) {
    return [];
  }

  const videoGenreColumnExists = await hasVideoGenreColumn();
  if (!videoGenreColumnExists) {
    return [];
  }

  const requestedOffset = Math.max(0, Number.isFinite(options.offset) ? Number(options.offset) : 0);
  const requestedLimit = Math.max(1, Math.min(2_000, Number.isFinite(options.limit) ? Number(options.limit) : 48));
  const videoArtistNormColumn = await getVideoArtistNormalizationColumn();
  const videoArtistNormExpr = getCategoryArtistNormalizationExpr("v", videoArtistNormColumn);
  const videoArtistIndexHint = await getVideoArtistNormalizationIndexHintClause(videoArtistNormColumn);
  const normalizedGenreSqlExpr = "LOWER(TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(v.genre, '-', ' '), '_', ' '), '/', ' '), '.', ' '), ',', ' ')))";
  const hasPinnedCategoryArtistThumbs = await hasCategoryArtistThumbnailTable();

  const pinnedArtistThumbJoin = hasPinnedCategoryArtistThumbs
    ? `LEFT JOIN category_artist_thumbnails cat
       ON cat.genre_norm = ?
      AND cat.artist_key = ${videoArtistNormExpr}`
    : "";

  const thumbnailSelectExpr = hasPinnedCategoryArtistThumbs
    ? "COALESCE(cat.thumbnail_video_id, SUBSTRING_INDEX(GROUP_CONCAT(v.videoId ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.id ASC), ',', 1))"
    : "SUBSTRING_INDEX(GROUP_CONCAT(v.videoId ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.id ASC), ',', 1)";
  const groupByExpr = hasPinnedCategoryArtistThumbs
    ? `${videoArtistNormExpr}, cat.thumbnail_video_id`
    : videoArtistNormExpr;
  const normalizedGenrePlaceholders = normalizedGenreTerms.map(() => "?").join(", ");

  const rows = await prisma.$queryRawUnsafe<Array<{
    artistName: string | null;
    thumbnailVideoId: string | null;
    dominantGenre: string | null;
    videoCount: bigint | number;
  }>>(
    `SELECT
       MAX(COALESCE(NULLIF(TRIM(v.parsedArtist), ''), NULLIF(TRIM(v.channelTitle), ''))) AS artistName,
       ${thumbnailSelectExpr} AS thumbnailVideoId,
       SUBSTRING_INDEX(GROUP_CONCAT(NULLIF(TRIM(v.genre), '') ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.id ASC), ',', 1) AS dominantGenre,
       COUNT(*) AS videoCount
     FROM videos v${videoArtistIndexHint}
     ${pinnedArtistThumbJoin}
     WHERE v.videoId IS NOT NULL
       AND ${videoArtistNormExpr} <> ''
       AND COALESCE(v.approved, 0) = 1
       ${AVAILABLE_SITE_VIDEOS_EXISTS_CLAUSE}
       AND (
         ${normalizedGenreSqlExpr} IN (${normalizedGenrePlaceholders})
         OR LOWER(v.genre) REGEXP ?
       )
    GROUP BY ${groupByExpr}
     ORDER BY artistName ASC, videoCount DESC
    LIMIT ${requestedLimit}
     OFFSET ${requestedOffset}`,
    ...(hasPinnedCategoryArtistThumbs ? [normalizedGenre] : []),
    ...normalizedGenreTerms,
    normalizedGenrePattern,
  );

  return mapCategoryArtistRows(rows);
}

export async function getCategoryArtistsByGenre(
  genre: string,
  options?: { offset?: number; limit?: number },
): Promise<CategoryArtistCard[]> {
  if (!hasDatabaseUrl()) {
    return [];
  }

  requireDatabaseUrl("getCategoryArtistsByGenre");

  const requestedOffset = Math.max(0, Number.isFinite(options?.offset) ? Number(options?.offset) : 0);
  const requestedLimit = Math.max(1, Math.min(2_000, Number.isFinite(options?.limit) ? Number(options?.limit) : 48));
  const normalizedGenre = normalizeGenreTerm(genre);

  if (!normalizedGenre) {
    return [];
  }

  const cachedArtists = await getRuntimeCachedCategoryArtistsByGenre(normalizedGenre, {
    offset: requestedOffset,
    limit: requestedLimit,
  });
  if (cachedArtists) {
    return cachedArtists;
  }

  const artists = await queryCategoryArtistsByGenreFromVideos(genre, {
    offset: requestedOffset,
    limit: requestedLimit,
  });

  scheduleCategoryArtistRuntimeCacheRebuild(genre, normalizedGenre);
  return artists;
}

export async function getCategoryArtistCountByGenre(genre: string): Promise<number> {
  if (!hasDatabaseUrl()) {
    return 0;
  }

  requireDatabaseUrl("getCategoryArtistCountByGenre");

  const normalizedGenre = normalizeGenreTerm(genre);
  const normalizedGenreTerms = getExpandedGenreTerms(genre);
  const normalizedGenrePattern = buildGenreRegexPattern(normalizedGenreTerms);

  if (!normalizedGenre || normalizedGenreTerms.length === 0) {
    return 0;
  }

  const videoGenreColumnExists = await hasVideoGenreColumn();
  if (!videoGenreColumnExists) {
    return 0;
  }

  const videoArtistNormColumn = await getVideoArtistNormalizationColumn();
  const videoArtistIndexHint = await getVideoArtistNormalizationIndexHintClause(videoArtistNormColumn);
  const normalizedGenreSqlExpr = "LOWER(TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(v.genre, '-', ' '), '_', ' '), '/', ' '), '.', ' '), ',', ' ')))";
  const normalizedGenrePlaceholders = normalizedGenreTerms.map(() => "?").join(", ");

  let rows: Array<{ total: bigint | number }>;

  if (videoArtistNormColumn) {
    const normalizedRef = `v.${escapeSqlIdentifier(videoArtistNormColumn)}`;
    rows = await prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
      `SELECT COUNT(*) AS total
       FROM (
         SELECT ${normalizedRef} AS artistKey
         FROM videos v${videoArtistIndexHint}
         WHERE v.videoId IS NOT NULL
           AND ${normalizedRef} IS NOT NULL
           AND TRIM(${normalizedRef}) <> ''
           AND COALESCE(v.approved, 0) = 1
           ${AVAILABLE_SITE_VIDEOS_EXISTS_CLAUSE}
           AND (
             ${normalizedGenreSqlExpr} IN (${normalizedGenrePlaceholders})
             OR LOWER(v.genre) REGEXP ?
           )
         GROUP BY ${normalizedRef}

         UNION

         SELECT LOWER(TRIM(COALESCE(NULLIF(TRIM(v.parsedArtist), ''), NULLIF(TRIM(v.channelTitle), '')))) AS artistKey
         FROM videos v
         WHERE v.videoId IS NOT NULL
           AND (${normalizedRef} IS NULL OR TRIM(${normalizedRef}) = '')
           AND COALESCE(NULLIF(TRIM(v.parsedArtist), ''), NULLIF(TRIM(v.channelTitle), '')) IS NOT NULL
           AND COALESCE(v.approved, 0) = 1
           ${AVAILABLE_SITE_VIDEOS_EXISTS_CLAUSE}
           AND (
             ${normalizedGenreSqlExpr} IN (${normalizedGenrePlaceholders})
             OR LOWER(v.genre) REGEXP ?
           )
         GROUP BY artistKey
       ) category_artist_keys`,
      ...normalizedGenreTerms,
      normalizedGenrePattern,
      ...normalizedGenreTerms,
      normalizedGenrePattern,
    );
  } else {
    const videoArtistNormExpr = getCategoryArtistNormalizationExpr("v", null);
    rows = await prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
      `SELECT
         COUNT(DISTINCT ${videoArtistNormExpr}) AS total
       FROM videos v
       WHERE v.videoId IS NOT NULL
         AND ${videoArtistNormExpr} <> ''
         AND COALESCE(v.approved, 0) = 1
         ${AVAILABLE_SITE_VIDEOS_EXISTS_CLAUSE}
         AND (
           ${normalizedGenreSqlExpr} IN (${normalizedGenrePlaceholders})
           OR LOWER(v.genre) REGEXP ?
         )`,
      ...normalizedGenreTerms,
      normalizedGenrePattern,
    );
  }

  return Math.max(0, Number(rows[0]?.total ?? 0));
}

type CategoryArtistTabCountMatcher = {
  id: string;
  matches: (dominantGenre: string | null | undefined) => boolean;
};

function buildCategoryArtistTabCountMatchers(genre: string): CategoryArtistTabCountMatcher[] {
  const hasAny = (dominantGenre: string | null | undefined, patterns: RegExp[]) => {
    const normalized = (dominantGenre ?? "").trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return patterns.some((pattern) => pattern.test(normalized));
  };

  switch (genre) {
    case "Thrash & Power Metal":
      return [
        { id: "all", matches: () => true },
        { id: "thrash", matches: (value) => hasAny(value, [/thrash/i]) },
        { id: "power-speed", matches: (value) => hasAny(value, [/power/i, /speed/i]) },
        { id: "groove", matches: (value) => hasAny(value, [/groove/i]) },
      ];
    case "Black and Death Metal":
      return [
        { id: "all", matches: () => true },
        { id: "black", matches: (value) => hasAny(value, [/black/i]) },
        { id: "death", matches: (value) => hasAny(value, [/death/i]) },
        { id: "grind", matches: (value) => hasAny(value, [/grind/i]) },
      ];
    case "Doom & Sludge":
      return [
        { id: "all", matches: () => true },
        { id: "doom", matches: (value) => hasAny(value, [/doom/i]) },
        { id: "sludge-stoner", matches: (value) => hasAny(value, [/sludge/i, /stoner/i]) },
        { id: "drone", matches: (value) => hasAny(value, [/drone/i]) },
      ];
    case "Nu-metal & Metalcore":
      return [
        { id: "all", matches: () => true },
        { id: "nu-metal", matches: (value) => hasAny(value, [/nu\s*metal/i]) },
        { id: "metalcore", matches: (value) => hasAny(value, [/metalcore/i, /deathcore/i, /core/i]) },
        { id: "alt-rap", matches: (value) => hasAny(value, [/alternative/i, /rap/i]) },
      ];
    case "Progressive & Experimental":
      return [
        { id: "all", matches: () => true },
        { id: "progressive", matches: (value) => hasAny(value, [/progressive/i, /prog\b/i]) },
        { id: "post", matches: (value) => hasAny(value, [/post/i, /blackgaze/i]) },
        { id: "industrial-tech", matches: (value) => hasAny(value, [/industrial/i, /technical/i, /djent/i, /mathcore/i]) },
      ];
    case "Classic and Symphonic Metal":
      return [
        { id: "all", matches: () => true },
        { id: "traditional", matches: (value) => hasAny(value, [/heavy/i, /nwobhm/i, /traditional/i]) },
        { id: "symphonic", matches: (value) => hasAny(value, [/symphonic/i]) },
        { id: "glam", matches: (value) => hasAny(value, [/glam/i, /hair/i]) },
      ];
    case "Punk & Hardcore":
      return [
        { id: "all", matches: () => true },
        { id: "punk", matches: (value) => hasAny(value, [/punk/i]) },
        { id: "hardcore", matches: (value) => hasAny(value, [/hardcore/i, /powerviolence/i, /crust/i, /d beat/i]) },
        { id: "emo", matches: (value) => hasAny(value, [/emo/i, /screamo/i]) },
      ];
    case "Rock & Alternative":
      return [
        { id: "all", matches: () => true },
        { id: "classic-hard", matches: (value) => hasAny(value, [/classic rock/i, /hard rock/i, /heavy rock/i]) },
        { id: "alt-indie", matches: (value) => hasAny(value, [/alternative/i, /indie/i, /grunge/i, /shoegaze/i]) },
        { id: "other-rock", matches: (value) => hasAny(value, [/rock/i]) },
      ];
    default:
      return [{ id: "all", matches: () => true }];
  }
}

export async function getCategoryArtistTabCountsByGenre(genre: string): Promise<Record<string, number>> {
  if (!hasDatabaseUrl()) {
    return { all: 0 };
  }

  requireDatabaseUrl("getCategoryArtistTabCountsByGenre");

  const normalizedGenre = normalizeGenreTerm(genre);
  const normalizedGenreTerms = getExpandedGenreTerms(genre);
  const normalizedGenrePattern = buildGenreRegexPattern(normalizedGenreTerms);

  if (!normalizedGenre || normalizedGenreTerms.length === 0) {
    return { all: 0 };
  }

  const cachedArtists = await getRuntimeCachedCategoryArtistsByGenre(normalizedGenre, {
    offset: 0,
    limit: CATEGORY_ARTIST_RUNTIME_CACHE_REBUILD_LIMIT,
  });
  if (cachedArtists) {
    const matchers = buildCategoryArtistTabCountMatchers(genre);
    const counts: Record<string, number> = { all: cachedArtists.length };
    for (const matcher of matchers) {
      if (matcher.id === "all") {
        continue;
      }
      counts[matcher.id] = cachedArtists.reduce(
        (total, row) => total + (matcher.matches(row.dominantGenre) ? 1 : 0),
        0,
      );
    }

    return counts;
  }

  const videoGenreColumnExists = await hasVideoGenreColumn();
  if (!videoGenreColumnExists) {
    return { all: 0 };
  }

  const videoArtistNormColumn = await getVideoArtistNormalizationColumn();
  const videoArtistNormExpr = getCategoryArtistNormalizationExpr("v", videoArtistNormColumn);
  const videoArtistIndexHint = await getVideoArtistNormalizationIndexHintClause(videoArtistNormColumn);
  const normalizedGenreSqlExpr = "LOWER(TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(v.genre, '-', ' '), '_', ' '), '/', ' '), '.', ' '), ',', ' ')))";
  const normalizedGenrePlaceholders = normalizedGenreTerms.map(() => "?").join(", ");

  const rows = await prisma.$queryRawUnsafe<Array<{ dominantGenre: string | null }>>(
    `SELECT
       SUBSTRING_INDEX(GROUP_CONCAT(NULLIF(TRIM(v.genre), '') ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.id ASC), ',', 1) AS dominantGenre
     FROM videos v${videoArtistIndexHint}
     WHERE v.videoId IS NOT NULL
       AND ${videoArtistNormExpr} <> ''
       AND COALESCE(v.approved, 0) = 1
       ${AVAILABLE_SITE_VIDEOS_EXISTS_CLAUSE}
       AND (
         ${normalizedGenreSqlExpr} IN (${normalizedGenrePlaceholders})
         OR LOWER(v.genre) REGEXP ?
       )
     GROUP BY ${videoArtistNormExpr}`,
    ...normalizedGenreTerms,
    normalizedGenrePattern,
  );

  const matchers = buildCategoryArtistTabCountMatchers(genre);
  const counts: Record<string, number> = { all: rows.length };
  for (const matcher of matchers) {
    if (matcher.id === "all") {
      continue;
    }
    counts[matcher.id] = rows.reduce((total, row) => total + (matcher.matches(row.dominantGenre) ? 1 : 0), 0);
  }

  return counts;
}

export async function getVideosByGenreAndArtist(
  genre: string,
  artistName: string,
  options?: { offset?: number; limit?: number },
): Promise<VideoRecord[]> {
  if (!hasDatabaseUrl()) {
    return [];
  }

  requireDatabaseUrl("getVideosByGenreAndArtist");

  const normalizedGenre = normalizeGenreTerm(genre);
  const normalizedGenreTerms = getExpandedGenreTerms(genre);
  const normalizedArtist = normalizeArtistKey(artistName);
  const requestedOffset = Math.max(0, Number.isFinite(options?.offset) ? Number(options?.offset) : 0);
  const requestedLimit = Math.max(1, Math.min(120, Number.isFinite(options?.limit) ? Number(options?.limit) : 48));

  if (!normalizedGenre || normalizedGenreTerms.length === 0 || !normalizedArtist) {
    return [];
  }

  const videoGenreColumnExists = await hasVideoGenreColumn();
  if (!videoGenreColumnExists) {
    return [];
  }

  const normalizedGenrePattern = buildGenreRegexPattern(normalizedGenreTerms);
  const normalizedGenreSqlExpr = "LOWER(TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(v.genre, '-', ' '), '_', ' '), '/', ' '), '.', ' '), ',', ' ')))";
  const videoArtistNormColumn = await getVideoArtistNormalizationColumn();
    const videoArtistNormExpr = getCategoryArtistNormalizationExpr("v", videoArtistNormColumn);
  const videoArtistIndexHint = await getVideoArtistNormalizationIndexHintClause(videoArtistNormColumn);
  const normalizedGenrePlaceholders = normalizedGenreTerms.map(() => "?").join(", ");

  const rows = await prisma.$queryRawUnsafe<Array<{
    videoId: string;
    title: string;
    channelTitle: string | null;
    parsedArtist: string | null;
    parsedTrack: string | null;
    favourited: number | bigint | null;
    description: string | null;
  }>>(
    `SELECT
       v.videoId,
       v.title,
       NULLIF(TRIM(v.channelTitle), '') AS channelTitle,
       NULLIF(TRIM(v.parsedArtist), '') AS parsedArtist,
       NULLIF(TRIM(v.parsedTrack), '') AS parsedTrack,
       v.favourited,
       v.description
     FROM videos v${videoArtistIndexHint}
     WHERE v.videoId IS NOT NULL
       AND ${videoArtistNormExpr} = ?
       AND COALESCE(v.approved, 0) = 1
       ${AVAILABLE_SITE_VIDEOS_EXISTS_CLAUSE}
       AND (
         ${normalizedGenreSqlExpr} IN (${normalizedGenrePlaceholders})
         OR LOWER(v.genre) REGEXP ?
       )
     ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.id ASC
     LIMIT ${requestedLimit}
     OFFSET ${requestedOffset}`,
    normalizedArtist,
    ...normalizedGenreTerms,
    normalizedGenrePattern,
  );

  return rows.map(mapVideo);
}

// ── Cache clearing ────────────────────────────────────────────────────────────

function resetGenreCardCaches() {
  genreCardsCache = undefined;
  genreListCache = undefined;
}

function normalizeGenreTerm(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegexLiteral(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getExpandedGenreTerms(genre: string) {
  const normalized = [...new Set(
    getBucketTermsForGenreSelection(genre)
      .map(normalizeGenreTerm)
      .filter((term) => term.length > 0),
  )];

  if (normalized.length > 0) {
    return normalized;
  }

  const fallback = normalizeGenreTerm(genre);
  return fallback ? [fallback] : [];
}

function buildGenreRegexPattern(terms: string[]) {
  return terms
    .map((term) => `(^|[^a-z0-9])${escapeRegexLiteral(term).replace(/ /g, "[^a-z0-9]+")}([^a-z0-9]|$)`)
    .join("|");
}

export function clearGenreCaches() {
  genreArtistsCache.clear();
  genreVideosCache.clear();
  genreVideosInFlight.clear();
  genreArtistSeedCache.clear();
  genreArtistCountCache.clear();
  genreCardsCache = undefined;
  genreCardsInFlight = undefined;
  genreListCache = undefined;
}

export async function invalidateRuntimeCategoryCaches() {
  clearGenreCaches();

  if (!hasDatabaseUrl()) {
    return;
  }

  try {
    const tableAvailable = await hasCategoryBucketRuntimeCacheTable();
    if (!tableAvailable) {
      return;
    }

    await prisma.$executeRawUnsafe(
      `
        UPDATE category_bucket_runtime_cache
        SET updated_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 HOUR)
      `,
    );

    const artistRuntimeTableAvailable = await hasCategoryArtistRuntimeCacheTable();
    if (artistRuntimeTableAvailable) {
      await prisma.$executeRawUnsafe(
        `
          UPDATE category_artist_runtime_cache
          SET updated_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 HOUR)
        `,
      );
    }
  } catch {
    // best effort only
  }
}

export async function clearGenreCardThumbnailForVideo(videoId: string) {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);
  if (!normalizedVideoId || !hasDatabaseUrl()) return;

  try {
    const cleared = await prisma.$executeRaw`
      UPDATE genre_cards
      SET thumbnail_video_id = NULL
      WHERE CONVERT(thumbnail_video_id USING utf8mb4) = CONVERT(${normalizedVideoId} USING utf8mb4)
    `;
    await prisma.$executeRaw`
      UPDATE category_bucket_runtime_cache
      SET preview_video_id = NULL,
          updated_at = UTC_TIMESTAMP(3)
      WHERE CONVERT(preview_video_id USING utf8mb4) = CONVERT(${normalizedVideoId} USING utf8mb4)
    `.catch(() => undefined);
    await prisma.$executeRaw`
      UPDATE category_artist_runtime_cache
      SET thumbnail_video_id = NULL,
          updated_at = UTC_TIMESTAMP(3)
      WHERE CONVERT(thumbnail_video_id USING utf8mb4) = CONVERT(${normalizedVideoId} USING utf8mb4)
    `.catch(() => undefined);
    if (Number(cleared) > 0) {
      resetGenreCardCaches();
    }
  } catch {
    // best effort only
  }
}

// ── Genre queries ─────────────────────────────────────────────────────────────

export async function getGenres() {
  requireDatabaseUrl("getGenres");

  const now = Date.now();
  if (genreListCache && genreListCache.expiresAt > now) return genreListCache.genres;

  try {
    const rows = await prisma.$queryRaw<Array<{ genre: string }>>`
      SELECT genre FROM genre_cards ORDER BY genre ASC LIMIT 1000
    `;

    if (rows.length > 0) {
      const genres = rows.map((r: { genre: string }) => r.genre);
      genreListCache = { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, genres };
      return genres;
    }

    const fallbackRows = await prisma.$queryRaw<Array<{ genre: string }>>`
      SELECT name AS genre FROM genres WHERE name IS NOT NULL AND TRIM(name) <> '' ORDER BY name ASC LIMIT 500
    `;
    const genres = fallbackRows.map((r: { genre: string }) => r.genre);
    genreListCache = { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, genres };
    return genres;
  } catch (error) {
    if (genreListCache?.genres) {
      return genreListCache.genres;
    }
    throw error;
  }
}

export async function getGenreCards(): Promise<GenreCard[]> {
  requireDatabaseUrl("getGenreCards");

  const now = Date.now();
  if (!genreCardsCache || genreCardsCache.expiresAt <= now) {
    try {
      const runtimeCached = await getRuntimeCachedTopLevelGenreCards();
      if (runtimeCached && runtimeCached.length > 0) {
        genreCardsCache = { expiresAt: now + GENRE_CARDS_CACHE_TTL_MS, cards: runtimeCached };
        return runtimeCached;
      }
    } catch {
      // fall through to the richer rebuild path.
    }
  }

  if (
    genreCardsCache &&
    genreCardsCache.expiresAt > now &&
    genreCardsCache.cards.length > 0 &&
    genreCardsCache.cards.some((card) => !!card.previewVideoId)
  ) {
    return genreCardsCache.cards;
  }

  if (genreCardsInFlight) {
    return genreCardsInFlight;
  }

  genreCardsInFlight = (async () => {
    try {
      const rows = await prisma.$queryRaw<Array<{ genre: string; thumbnailVideoId?: string | null; thumbnail_video_id?: string | null }>>`
        SELECT gc.genre, MAX(gc.thumbnail_video_id) AS thumbnailVideoId
        FROM genre_cards gc
        WHERE gc.thumbnail_video_id IS NOT NULL
          AND gc.thumbnail_video_id <> ''
          AND gc.genre IS NOT NULL
          AND TRIM(gc.genre) <> ''
          AND EXISTS (
            SELECT 1 FROM videos v
            INNER JOIN site_videos sv ON sv.video_id = v.id
            WHERE v.genre = gc.genre
              AND sv.status = 'available'
          )
        GROUP BY gc.genre
        ORDER BY genre ASC
        LIMIT 1000
      `;

      let cards: GenreCard[] = rows.map((row: { genre: string; thumbnailVideoId?: string | null; thumbnail_video_id?: string | null }) => ({
        genre: row.genre,
        previewVideoId: row.thumbnailVideoId ?? row.thumbnail_video_id ?? null,
        artistCount: 0,
      }));

      if (cards.length === 0) {
        const fallbackRows = await prisma.$queryRaw<Array<{ genre: string; thumbnailVideoId?: string | null; thumbnail_video_id?: string | null }>>`
          SELECT gc.genre, MAX(gc.thumbnail_video_id) AS thumbnailVideoId
          FROM genre_cards gc
          WHERE gc.genre IS NOT NULL AND TRIM(gc.genre) <> ''
          GROUP BY gc.genre
          ORDER BY gc.genre ASC
          LIMIT 1000
        `;
        if (fallbackRows.length > 0) {
          cards = fallbackRows.map((r: { genre: string; thumbnailVideoId?: string | null; thumbnail_video_id?: string | null }) => ({
            genre: r.genre,
            previewVideoId: r.thumbnailVideoId ?? r.thumbnail_video_id ?? null,
            artistCount: 0,
          }));
        } else {
          const genreRows = await prisma.$queryRaw<Array<{ genre: string }>>`
            SELECT name AS genre FROM genres WHERE name IS NOT NULL AND TRIM(name) <> '' ORDER BY name ASC LIMIT 1000
          `;
          cards = genreRows.map((r: { genre: string }) => ({ genre: r.genre, previewVideoId: null, artistCount: 0 }));
        }
      }

      if (cards.length === 0) {
        cards = (await getGenres()).map((genre: string) => ({ genre, previewVideoId: null, artistCount: 0 }));
      }

      if (cards.some((card) => !card.previewVideoId)) {
        const thumbnailRows = await prisma.$queryRaw<Array<{ genre: string; thumbnailVideoId?: string | null; thumbnail_video_id?: string | null }>>`
          SELECT
            v.genre AS genre,
            SUBSTRING_INDEX(
              GROUP_CONCAT(v.videoId ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.id ASC),
              ',', 1
            ) AS thumbnailVideoId
          FROM videos v
          INNER JOIN site_videos sv ON sv.video_id = v.id AND sv.status = 'available'
          WHERE v.genre IS NOT NULL AND TRIM(v.genre) <> ''
          GROUP BY v.genre
          ORDER BY v.genre ASC
          LIMIT 1000
        `;

        if (thumbnailRows.length > 0) {
          const thumbnailByGenre = new Map<string, string>();
          for (const row of thumbnailRows) {
            const genreKey = row.genre.trim().toLowerCase();
            const videoId = (row.thumbnailVideoId ?? row.thumbnail_video_id ?? "").trim();
            if (!genreKey || !videoId) continue;
            thumbnailByGenre.set(genreKey, videoId);
          }
          cards = cards.map((card) => {
            if (card.previewVideoId) return card;
            const derived = thumbnailByGenre.get(card.genre.trim().toLowerCase()) ?? null;
            return derived ? { ...card, previewVideoId: derived } : card;
          });
        }

        if (cards.some((card) => !card.previewVideoId)) {
          const looseThumbnailRows = await prisma.$queryRaw<Array<{ genre: string; thumbnailVideoId?: string | null; thumbnail_video_id?: string | null }>>`
            SELECT
              v.genre AS genre,
              SUBSTRING_INDEX(
                GROUP_CONCAT(v.videoId ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.id ASC),
                ',', 1
              ) AS thumbnailVideoId
            FROM videos v
            WHERE v.genre IS NOT NULL AND TRIM(v.genre) <> ''
            GROUP BY v.genre
            ORDER BY v.genre ASC
            LIMIT 1000
          `;
          if (looseThumbnailRows.length > 0) {
            const loose = new Map<string, string>();
            for (const row of looseThumbnailRows) {
              const genreKey = row.genre.trim().toLowerCase();
              const videoId = (row.thumbnailVideoId ?? row.thumbnail_video_id ?? "").trim();
              if (!genreKey || !videoId) continue;
              loose.set(genreKey, videoId);
            }
            cards = cards.map((card) => {
              if (card.previewVideoId) return card;
              return { ...card, previewVideoId: loose.get(card.genre.trim().toLowerCase()) ?? null };
            });
          }
        }

        if (cards.some((card) => !card.previewVideoId)) {
          const fuzzyRows = await prisma.$queryRaw<Array<{ genre: string; thumbnailVideoId?: string | null; thumbnail_video_id?: string | null }>>`
            SELECT
              gc.genre AS genre,
              SUBSTRING_INDEX(
                GROUP_CONCAT(v.videoId ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.id ASC),
                ',', 1
              ) AS thumbnailVideoId
            FROM genre_cards gc
            LEFT JOIN videos v
              ON v.genre IS NOT NULL AND TRIM(v.genre) <> ''
             AND LOWER(v.genre) LIKE CONCAT('%', LOWER(gc.genre), '%')
            WHERE gc.genre IS NOT NULL AND TRIM(gc.genre) <> ''
            GROUP BY gc.genre
            ORDER BY gc.genre ASC
            LIMIT 1000
          `;
          if (fuzzyRows.length > 0) {
            const fuzzy = new Map<string, string>();
            for (const row of fuzzyRows) {
              const genreKey = row.genre.trim().toLowerCase();
              const videoId = (row.thumbnailVideoId ?? row.thumbnail_video_id ?? "").trim();
              if (!genreKey || !videoId) continue;
              fuzzy.set(genreKey, videoId);
            }
            cards = cards.map((card) => {
              if (card.previewVideoId) return card;
              return { ...card, previewVideoId: fuzzy.get(card.genre.trim().toLowerCase()) ?? null };
            });
          }
        }
      }

      cards = collateGenreCardsToTopLevelBuckets(cards);
      const pinnedPreviewByBucket = await getPinnedCategoryArtistPreviewsByBucket();
      cards = applyPinnedCategoryArtistPreviews(cards, pinnedPreviewByBucket);
      await upsertCategoryBucketRuntimeCache(cards).catch(() => undefined);

      genreCardsCache = { expiresAt: now + GENRE_CARDS_CACHE_TTL_MS, cards };
      genreListCache = { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, genres: cards.map((c: GenreCard) => c.genre) };
      return cards;
    } catch {
      try {
        const rawFallbackRows = await prisma.$queryRaw<Array<{ genre: string; thumbnailVideoId?: string | null; thumbnail_video_id?: string | null }>>`
          SELECT genre, thumbnail_video_id AS thumbnailVideoId
          FROM genre_cards
          WHERE genre IS NOT NULL AND TRIM(genre) <> ''
          ORDER BY genre ASC
          LIMIT 1000
        `;
        if (rawFallbackRows.length > 0) {
          let fallbackCards = collateGenreCardsToTopLevelBuckets(rawFallbackRows.map((row: { genre: string; thumbnailVideoId?: string | null; thumbnail_video_id?: string | null }) => ({
            genre: row.genre,
            previewVideoId: row.thumbnailVideoId ?? row.thumbnail_video_id ?? null,
            artistCount: 0,
          })));
          const pinnedPreviewByBucket = await getPinnedCategoryArtistPreviewsByBucket();
          fallbackCards = applyPinnedCategoryArtistPreviews(fallbackCards, pinnedPreviewByBucket);
          genreCardsCache = { expiresAt: now + 30_000, cards: fallbackCards };
          return fallbackCards;
        }
      } catch {
        // fall through
      }

      const fallbackCards = collateGenreCardsToTopLevelBuckets((await getGenres()).map((genre: string) => ({ genre, previewVideoId: null, artistCount: 0 })));
      genreCardsCache = { expiresAt: now + 30_000, cards: fallbackCards };
      return fallbackCards;
    }
  })().finally(() => {
    genreCardsInFlight = undefined;
  });

  if (!genreCardsCache) return genreCardsInFlight;
  return genreCardsCache.cards;
}

export async function getGenreBySlug(slug: string) {
  const bucket = getTopLevelGenreBucketBySlug(slug);
  if (bucket) {
    return bucket;
  }

  const genres = await getGenres();
  return genres.find((genre: string) => getGenreSlug(genre) === slug);
}

// ── Artists by genre ──────────────────────────────────────────────────────────

function getArtistsByGenreFallback(genre: string) {
  void genre;
  return [] as ArtistRecord[];
}

export async function getArtistsByGenre(genre: string) {
  const expandedTerms = getExpandedGenreTerms(genre);
  const cacheKey = expandedTerms.join("|") || genre.trim().toLowerCase();
  const now = Date.now();
  const cached = genreArtistsCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.artists;
  if (!hasDatabaseUrl()) {
    const fallbackArtists = getArtistsByGenreFallback(genre);
    genreArtistsCache.set(cacheKey, { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, artists: fallbackArtists });
    return fallbackArtists;
  }
  requireDatabaseUrl("getArtistsByGenre");

  const sourceTerms = expandedTerms.length > 0 ? expandedTerms : [genre.trim()].filter((term) => term.length > 0);
  if (sourceTerms.length === 0) {
    return [];
  }

  try {
    const genreAllExists = await hasGenreAllColumn();
    const useFulltext = genreAllExists && sourceTerms.length === 1 && sourceTerms[0].length >= 3;

    const artists = useFulltext
      ? await prisma.$queryRaw<Array<{ name: string; country: string | null; genre1: string | null }>>`
          SELECT /*+ MAX_EXECUTION_TIME(${CATEGORY_QUERY_DB_MAX_EXECUTION_MS}) */
                 a.artist AS name, a.country,
                 COALESCE(a.genre1, a.genre2, a.genre3, a.genre4, a.genre5, a.genre6) AS genre1
          FROM artists a
          WHERE MATCH(a.genre_all) AGAINST (${sourceTerms[0]} IN BOOLEAN MODE)
        `
      : genreAllExists
        ? await prisma.$queryRawUnsafe<Array<{ name: string; country: string | null; genre1: string | null }>>(
            `SELECT /*+ MAX_EXECUTION_TIME(${CATEGORY_QUERY_DB_MAX_EXECUTION_MS}) */
                    a.artist AS name, a.country,
                    COALESCE(a.genre1, a.genre2, a.genre3, a.genre4, a.genre5, a.genre6) AS genre1
             FROM artists a
             WHERE (${sourceTerms.map(() => "a.genre_all LIKE ?").join(" OR ")})`,
            ...sourceTerms.map((term) => `%${term}%`),
          )
        : await prisma.$queryRawUnsafe<Array<{ name: string; country: string | null; genre1: string | null }>>(
            `SELECT /*+ MAX_EXECUTION_TIME(${CATEGORY_QUERY_DB_MAX_EXECUTION_MS}) */
                    a.artist AS name, a.country,
                    COALESCE(a.genre1, a.genre2, a.genre3, a.genre4, a.genre5, a.genre6) AS genre1
             FROM artists a
             WHERE (${sourceTerms.flatMap(() => [
               "a.genre1 LIKE ?",
               "a.genre2 LIKE ?",
               "a.genre3 LIKE ?",
               "a.genre4 LIKE ?",
               "a.genre5 LIKE ?",
               "a.genre6 LIKE ?",
             ]).join(" OR ")})`,
            ...sourceTerms.flatMap((term) => [
              `%${term}%`,
              `%${term}%`,
              `%${term}%`,
              `%${term}%`,
              `%${term}%`,
              `%${term}%`,
            ]),
          );

    const mappedArtists = artists.map(mapArtist).sort((a: ArtistRecord, b: ArtistRecord) => a.name.localeCompare(b.name));

    genreArtistsCache.set(cacheKey, { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, artists: mappedArtists });
    return mappedArtists;
  } catch (error) {
    if (cached) {
      return cached.artists;
    }
    throw error;
  }
}

// ── Videos by genre ───────────────────────────────────────────────────────────

export async function getVideosByGenre(
  genre: string,
  options?: {
    artists?: Awaited<ReturnType<typeof getArtistsByGenre>>;
    offset?: number;
    limit?: number;
  },
) {
  const expandedGenreTerms = getExpandedGenreTerms(genre);
  const cacheKey = expandedGenreTerms.join("|") || genre.trim().toLowerCase();
  const normalizedGenre = expandedGenreTerms[0] ?? normalizeGenreTerm(genre);
  const normalizedGenrePattern = buildGenreRegexPattern(expandedGenreTerms);
  const requestedOffset = Math.max(0, Number.isFinite(options?.offset) ? Number(options?.offset) : 0);
  const requestedLimit = Math.max(1, Math.min(120, Number.isFinite(options?.limit) ? Number(options?.limit) : 24));
  const minRequiredRows = requestedOffset + requestedLimit;
  const useDefaultCacheWindow = !options?.artists && requestedOffset === 0 && requestedLimit === 24;
  const fetchQueryLimit = Math.max(requestedLimit + requestedOffset + 24, requestedLimit + 24);
  const now = Date.now();

  if (!hasDatabaseUrl()) {
    return [];
  }

  if (useDefaultCacheWindow) {
    const cached = genreVideosCache.get(cacheKey);
    if (cached && cached.expiresAt > now && cached.videos.length > 0) return cached.videos;
    if (cached && cached.videos.length === 0) genreVideosCache.delete(cacheKey);
  }

  const storeGenreVideosInCache = (videos: VideoRecord[]) => {
    if (useDefaultCacheWindow && videos.length > 0) {
      genreVideosCache.set(cacheKey, { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, videos });
    }
  };

  let bestRows: RankedVideoRow[] = [];

  const considerRows = (rows: RankedVideoRow[]) => {
    if (!rows || rows.length === 0) return;
    bestRows = dedupeRankedRows([...bestRows, ...rows]);
  };

  const canResolveWindow = () => bestRows.length >= minRequiredRows;

  const resolveFromBestRows = () => {
    if (bestRows.length === 0) return [] as VideoRecord[];
    return dedupeRankedRows(bestRows).slice(requestedOffset, requestedOffset + requestedLimit).map(mapVideo);
  };

  const getGenreFallback = async () => {
    return [];
  };

  const genreSearchText = expandedGenreTerms.join(" ") || genre;

  const getGenreKeywordVideos = async () => {
    return prisma.$queryRaw<RankedVideoRow[]>`
      SELECT
        v.videoId, v.title, NULL AS channelTitle, v.favourited, v.description
      FROM videos v
      WHERE MATCH(v.title, v.parsedArtist, v.parsedTrack) AGAINST (${genreSearchText} IN NATURAL LANGUAGE MODE)
        AND v.videoId IS NOT NULL
        AND COALESCE(v.approved, 0) = 1
        AND EXISTS (
          SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'available'
        )
        AND NOT EXISTS (
          SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND (sv.status IS NULL OR sv.status <> 'available')
        )
      ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
      LIMIT ${fetchQueryLimit}
    `;
  };

  const getStrictGenreColumnVideos = async () => {
    if (!normalizedGenre || expandedGenreTerms.length === 0) {
      return [] as RankedVideoRow[];
    }

    const videoGenreColumnExists = await hasVideoGenreColumn();
    if (!videoGenreColumnExists) {
      return [] as RankedVideoRow[];
    }

    const normalizedGenreSqlExpr = "LOWER(TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(v.genre, '-', ' '), '_', ' '), '/', ' '), '.', ' '), ',', ' ')))";

    const normalizedGenrePlaceholders = expandedGenreTerms.map(() => "?").join(", ");

    return prisma.$queryRawUnsafe<RankedVideoRow[]>(
      `SELECT /*+ MAX_EXECUTION_TIME(${CATEGORY_QUERY_DB_MAX_EXECUTION_MS}) */
         v.videoId, v.title, NULL AS channelTitle, v.favourited, v.description
       FROM videos v
       WHERE v.videoId IS NOT NULL
         AND v.genre IS NOT NULL
         AND TRIM(v.genre) <> ''
         AND COALESCE(v.approved, 0) = 1
         AND EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'available')
         AND NOT EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND (sv.status IS NULL OR sv.status <> 'available'))
         AND (
           ${normalizedGenreSqlExpr} IN (${normalizedGenrePlaceholders})
           OR LOWER(v.genre) REGEXP ?
         )
       ORDER BY
         CASE
           WHEN ${normalizedGenreSqlExpr} IN (${normalizedGenrePlaceholders}) THEN 0
           ELSE 1
         END,
         v.favourited DESC,
         COALESCE(v.viewCount, 0) DESC,
         v.videoId ASC
       LIMIT ${fetchQueryLimit}`,
      ...expandedGenreTerms,
      normalizedGenrePattern,
      ...expandedGenreTerms,
    );
  };

  requireDatabaseUrl("getVideosByGenre");

  try {
    return await withSoftTimeout(`getVideosByGenre:${cacheKey}`, CATEGORY_QUERY_TIMEOUT_MS, async () => {
      const strictGenreVideos = await getStrictGenreColumnVideos();
      considerRows(strictGenreVideos);

      if (canResolveWindow()) {
        const resolved = resolveFromBestRows();
        storeGenreVideosInCache(resolved);
        return resolved;
      }

      const keywordVideos = await getGenreKeywordVideos();
      considerRows(keywordVideos);

      if (canResolveWindow()) {
        const resolved = resolveFromBestRows();
        storeGenreVideosInCache(resolved);
        return resolved;
      }

      const artistColumns = await getArtistColumnMap();
      const videoArtistNormColumn = await getVideoArtistNormalizationColumn();
      const videoArtistNormExpr = getVideoArtistNormalizationExpr("v", videoArtistNormColumn);
      const videoArtistIndexHint = await getVideoArtistNormalizationIndexHintClause(videoArtistNormColumn);

      if (artistColumns.genreColumns.length > 0) {
        const artistNameColumn = escapeSqlIdentifier(artistColumns.name);
        const genreAllExists = await hasGenreAllColumn();
        const useFulltext = genreAllExists && expandedGenreTerms.length === 1 && expandedGenreTerms[0].length >= 3;

        const artistLookupCacheKey = expandedGenreTerms.join("|") || normalizeGenreTerm(genre);
        const cachedArtistSeeds = artistLookupCacheKey ? genreArtistSeedCache.get(artistLookupCacheKey) : undefined;
        const normalizedGenreArtistNames = cachedArtistSeeds && cachedArtistSeeds.expiresAt > Date.now()
          ? cachedArtistSeeds.artistNames
          : await (async () => {
              let artistGenreRows: Array<{ artistName: string | null }>;
              if (useFulltext) {
                // Single FULLTEXT index seek — avoids 6× full-table LIKE scans
                artistGenreRows = await prisma.$queryRawUnsafe<Array<{ artistName: string | null }>>(
                  `SELECT /*+ MAX_EXECUTION_TIME(${CATEGORY_QUERY_DB_MAX_EXECUTION_MS}) */ a.${artistNameColumn} AS artistName FROM artists a WHERE MATCH(a.genre_all) AGAINST (? IN BOOLEAN MODE) LIMIT 64`,
                  expandedGenreTerms[0],
                );
              } else if (genreAllExists) {
                // genre_all exists but term too short for FULLTEXT minimum word length — single-column LIKE
                const genrePredicates = expandedGenreTerms.map(() => "a.genre_all LIKE ?").join(" OR ");
                const genreParams = expandedGenreTerms.map((term) => `%${term}%`);
                artistGenreRows = await prisma.$queryRawUnsafe<Array<{ artistName: string | null }>>(
                  `SELECT /*+ MAX_EXECUTION_TIME(${CATEGORY_QUERY_DB_MAX_EXECUTION_MS}) */ a.${artistNameColumn} AS artistName FROM artists a WHERE (${genrePredicates}) LIMIT 64`,
                  ...genreParams,
                );
              } else {
                // Fallback: 6× LIKE on individual genre columns
                const genrePredicates: string[] = [];
                const genreParams: string[] = [];
                for (const term of expandedGenreTerms) {
                  for (const column of artistColumns.genreColumns) {
                    genrePredicates.push(`a.${escapeSqlIdentifier(column)} LIKE CONCAT('%', ?, '%')`);
                    genreParams.push(term);
                  }
                }
                artistGenreRows = await prisma.$queryRawUnsafe<Array<{ artistName: string | null }>>(
                  `SELECT /*+ MAX_EXECUTION_TIME(${CATEGORY_QUERY_DB_MAX_EXECUTION_MS}) */ a.${artistNameColumn} AS artistName FROM artists a WHERE (${genrePredicates}) LIMIT 64`,
                  ...genreParams,
                );
              }

              const artistNames = [...new Set(
                artistGenreRows
                  .map((row: { artistName: string | null }) => normalizeArtistKey(row.artistName ?? ""))
                  .filter((name: string) => name.length > 0),
              )];

              if (artistLookupCacheKey) {
                genreArtistSeedCache.set(artistLookupCacheKey, {
                  expiresAt: Date.now() + GENRE_ARTIST_SEED_CACHE_TTL_MS,
                  artistNames,
                });
              }

              return artistNames;
            })();

        if (normalizedGenreArtistNames.length > 0) {
          const placeholders = normalizedGenreArtistNames.map(() => "?").join(", ");
          const artistGenreMatchedVideos = await prisma.$queryRawUnsafe<RankedVideoRow[]>(
            `
              SELECT /*+ MAX_EXECUTION_TIME(${CATEGORY_QUERY_DB_MAX_EXECUTION_MS}) */ v.videoId, v.title, NULL AS channelTitle, v.favourited, v.description
              FROM videos v${videoArtistIndexHint}
              WHERE ${videoArtistNormExpr} IN (${placeholders})
                AND v.videoId IS NOT NULL
                AND COALESCE(v.approved, 0) = 1
                AND EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'available')
                AND NOT EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND (sv.status IS NULL OR sv.status <> 'available'))
              ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
              LIMIT ${fetchQueryLimit}
            `,
            ...normalizedGenreArtistNames,
          );
          considerRows(artistGenreMatchedVideos);
        }
      }

      if (canResolveWindow()) {
        const resolved = resolveFromBestRows();
        storeGenreVideosInCache(resolved);
        return resolved;
      }

      const artists = options?.artists ?? (await getArtistsByGenre(genre));
      const artistNames = [...new Set<string>(artists.map((artist: any) => String(artist.name ?? "")).filter((name: string) => name.length > 0))].slice(0, 32);

      if (artistNames.length === 0) {
        if (bestRows.length > 0) {
          const resolved = resolveFromBestRows();
          storeGenreVideosInCache(resolved);
          return resolved;
        }
        const fallback = await getGenreFallback();
        storeGenreVideosInCache(fallback);
        return fallback;
      }

      const fulltextTerm = artistNames
        .map((name: string) => (name.includes(" ") ? `"${name}"` : name))
        .join(" ");

      const videos = await prisma.$queryRaw<RankedVideoRow[]>`
        SELECT /*+ MAX_EXECUTION_TIME(${CATEGORY_QUERY_DB_MAX_EXECUTION_MS}) */ v.videoId, v.title, NULL AS channelTitle, v.favourited, v.description
        FROM videos v
        WHERE MATCH(v.title, v.parsedArtist, v.parsedTrack) AGAINST (${fulltextTerm} IN BOOLEAN MODE)
          AND v.videoId IS NOT NULL
          AND COALESCE(v.approved, 0) = 1
          AND EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'available')
          AND NOT EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND (sv.status IS NULL OR sv.status <> 'available'))
        ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
        LIMIT ${fetchQueryLimit}
      `;
      considerRows(videos);

      if (canResolveWindow()) {
        const resolved = resolveFromBestRows();
        storeGenreVideosInCache(resolved);
        return resolved;
      }

      const normalizedArtistNames = artistNames
        .map((name: string) => normalizeArtistKey(name))
        .filter((name: string) => name.length > 0)
        .slice(0, 32);

      if (normalizedArtistNames.length > 0) {
        const placeholders = normalizedArtistNames.map(() => "?").join(", ");
        const artistMatchedVideos = await prisma.$queryRawUnsafe<RankedVideoRow[]>(
          `
            SELECT /*+ MAX_EXECUTION_TIME(${CATEGORY_QUERY_DB_MAX_EXECUTION_MS}) */ v.videoId, v.title, NULL AS channelTitle, v.favourited, v.description
            FROM videos v
            WHERE ${videoArtistNormExpr} IN (${placeholders})
              AND v.videoId IS NOT NULL
              AND COALESCE(v.approved, 0) = 1
              AND EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'available')
              AND NOT EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND (sv.status IS NULL OR sv.status <> 'available'))
            ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
            LIMIT ${fetchQueryLimit}
          `,
          ...normalizedArtistNames,
        );
        considerRows(artistMatchedVideos);

        if (canResolveWindow()) {
          const resolved = resolveFromBestRows();
          storeGenreVideosInCache(resolved);
          return resolved;
        }
      }

      const genreTerm = genreSearchText.trim();
      const hasVideoFT = await hasVideoTitleFulltextIndex();
      const useVideoFulltext = hasVideoFT && genreTerm.length >= 3;

      let textMatchedVideos: RankedVideoRow[];
      if (useVideoFulltext) {
        // MATCH AGAINST on the (title, parsedArtist, parsedTrack) FULLTEXT index —
        // avoids 4× LOWER() LIKE '%term%' full-table scans (~2.8M rows examined per call)
        textMatchedVideos = await prisma.$queryRawUnsafe<RankedVideoRow[]>(
          `SELECT /*+ MAX_EXECUTION_TIME(${CATEGORY_QUERY_DB_MAX_EXECUTION_MS}) */ v.videoId, v.title, NULL AS channelTitle, v.favourited, v.description
           FROM videos v
           WHERE MATCH(v.title, v.parsedArtist, v.parsedTrack) AGAINST (? IN BOOLEAN MODE)
             AND v.videoId IS NOT NULL
             AND COALESCE(v.approved, 0) = 1
             AND EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'available')
             AND NOT EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND (sv.status IS NULL OR sv.status <> 'available'))
           ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
           LIMIT ${fetchQueryLimit}`,
          genreTerm,
        );
      } else {
        // Fallback: term too short for FULLTEXT or index absent.
        // LOWER() removed — utf8mb4_unicode_ci comparison is already case-insensitive.
        // description column excluded — it's large and rarely differentiates genre results.
        const likeNeedle = `%${genreTerm}%`;
        textMatchedVideos = await prisma.$queryRawUnsafe<RankedVideoRow[]>(
          `SELECT /*+ MAX_EXECUTION_TIME(${CATEGORY_QUERY_DB_MAX_EXECUTION_MS}) */ v.videoId, v.title, NULL AS channelTitle, v.favourited, v.description
           FROM videos v
           WHERE v.videoId IS NOT NULL
             AND COALESCE(v.approved, 0) = 1
             AND (v.title LIKE ? OR v.parsedArtist LIKE ? OR v.parsedTrack LIKE ?)
             AND EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'available')
             AND NOT EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND (sv.status IS NULL OR sv.status <> 'available'))
           ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
           LIMIT ${fetchQueryLimit}`,
          likeNeedle,
          likeNeedle,
          likeNeedle,
        );
      }
      considerRows(textMatchedVideos);

      if (canResolveWindow()) {
        const resolved = resolveFromBestRows();
        storeGenreVideosInCache(resolved);
        return resolved;
      }

      if (bestRows.length > 0) {
        const resolved = resolveFromBestRows();
        storeGenreVideosInCache(resolved);
        return resolved;
      }

      const genreCardFallbackRows = await prisma.$queryRaw<Array<{ videoId: string; title: string; channelTitle: string | null; favourited: number | bigint | null; description: string | null }>>`
        SELECT v.videoId, v.title, NULL AS channelTitle, v.favourited, v.description
        FROM genre_cards gc
        INNER JOIN videos v ON CONVERT(v.videoId USING utf8mb4) = CONVERT(gc.thumbnail_video_id USING utf8mb4)
        INNER JOIN site_videos sv ON sv.video_id = v.id AND sv.status = 'available'
        WHERE LOWER(TRIM(gc.genre)) = LOWER(TRIM(${genre}))
          AND COALESCE(v.approved, 0) = 1
        ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
        LIMIT 1
      `;

      if (genreCardFallbackRows.length > 0) {
        const resolved = genreCardFallbackRows
          .slice(requestedOffset, requestedOffset + requestedLimit)
          .map(mapVideo);
        storeGenreVideosInCache(resolved);
        return resolved;
      }

      const fallback = await getGenreFallback();
      storeGenreVideosInCache(fallback);
      return fallback;
    });
  } catch (error) {
    throw error;
  }
}
