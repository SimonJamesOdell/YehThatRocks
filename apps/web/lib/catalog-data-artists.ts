/**
 * catalog-data-artists.ts
 * All artist-domain queries: artist stats projection, letter browsing,
 * slug lookup, per-artist video pool, same-genre related pool.
 */

import { prisma } from "@/lib/db";
import { BoundedMap } from "@/lib/bounded-map";
import type { ArtistRecord, VideoRecord } from "@/lib/catalog";
import {
  dedupeRankedRows,
  debugCatalog,
  escapeSqlIdentifier,
  hasDatabaseUrl,
  mapArtist,
  mapArtistProjectionRow,
  normalizeArtistKey,
  normalizeYouTubeVideoId,
  ROCK_METAL_GENRE_PATTERN,
  seedArtists,
  seedVideos,
  getSeedArtistBySlug,
  slugify,
  type RankedVideoRow,
} from "@/lib/catalog-data-utils";
import {
  AVAILABLE_SITE_VIDEOS_JOIN,
  ensureArtistSearchPrefixIndex,
  getArtistColumnMap,
  getArtistNameNormalizationExpr,
  getArtistVideoColumnMap,
  getVideoArtistNormalizationColumn,
  getVideoArtistNormalizationExpr,
  getVideoArtistNormalizationIndexHintClause,
  hasArtistStatsProjection,
  hasArtistStatsThumbnailColumn,
} from "@/lib/catalog-data-db";

// ── Cache constants ────────────────────────────────────────────────────────────

const ARTIST_NORM_VIDEO_POOL_CACHE_TTL_MS = 30 * 60 * 1000;
const ARTIST_NORM_VIDEO_POOL_MIN_ROWS = 72;
const ARTIST_NORM_VIDEO_POOL_HEADROOM_ROWS = 18;
const ARTIST_NORM_VIDEO_POOL_MAX_ROWS = 180;
const SAME_GENRE_RELATED_POOL_CACHE_TTL_MS = 5 * 60 * 1000;
const ARTIST_LETTER_CACHE_TTL_MS = 10 * 60 * 1000;
const ARTIST_LETTER_PAGE_CACHE_TTL_MS = 60_000;
const ARTIST_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const ARTIST_STATS_LETTER_BACKFILL_TTL_MS = 10 * 60 * 1000;
const ARTIST_PROJECTION_REFRESH_TTL_MS = 5 * 60 * 1000;
const ARTISTS_LIST_CACHE_TTL_MS = 5 * 60 * 1000;
const ARTIST_SLUG_LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;
const ARTIST_SINGLE_SLUG_CACHE_TTL_MS = 5 * 60 * 1000;
const ARTIST_VIDEOS_CACHE_TTL_MS = 60_000;
const KNOWN_ARTIST_MATCH_CACHE_TTL_MS = 10 * 60 * 1000;
const ARTIST_CATALOG_EVIDENCE_CACHE_TTL_MS = 10 * 60 * 1000;
const ARTIST_CACHE_MAX_ENTRIES = Math.max(
  200,
  Math.min(10_000, Number(process.env.ARTIST_CACHE_MAX_ENTRIES || "2000")),
);
const ENABLE_SAME_GENRE_RELATED = process.env.RELATED_ENABLE_SAME_GENRE === "1";
const BATCH_UPSERT_SIZE = 100;

// ── Cache stores ──────────────────────────────────────────────────────────────

const artistNormVideoPoolCache = new BoundedMap<string, { expiresAt: number; rows: RankedVideoRow[] }>(ARTIST_CACHE_MAX_ENTRIES);
const artistNormVideoPoolInFlight = new BoundedMap<string, { limit: number; promise: Promise<RankedVideoRow[]> }>(ARTIST_CACHE_MAX_ENTRIES);
const sameGenreRelatedPoolCache = new BoundedMap<string, { expiresAt: number; rows: RankedVideoRow[] }>(ARTIST_CACHE_MAX_ENTRIES);
const sameGenreRelatedPoolInFlight = new BoundedMap<string, Promise<RankedVideoRow[]>>(ARTIST_CACHE_MAX_ENTRIES);
const artistLetterCache = new BoundedMap<string, { expiresAt: number; rows: Array<ArtistRecord & { videoCount: number }> }>(ARTIST_CACHE_MAX_ENTRIES);
const artistLetterInFlight = new BoundedMap<string, Promise<Array<ArtistRecord & { videoCount: number }>>>(ARTIST_CACHE_MAX_ENTRIES);
const artistLetterPageCache = new BoundedMap<string, { expiresAt: number; rows: Array<ArtistRecord & { videoCount: number }> }>(ARTIST_CACHE_MAX_ENTRIES);
const artistLetterPageInFlight = new BoundedMap<string, Promise<Array<ArtistRecord & { videoCount: number }>>>(ARTIST_CACHE_MAX_ENTRIES);
const artistSearchCache = new BoundedMap<string, { expiresAt: number; rows: Array<{ name: string; country: string | null; genre1: string | null }> }>(ARTIST_CACHE_MAX_ENTRIES);
const artistSearchInFlight = new BoundedMap<string, Promise<Array<{ name: string; country: string | null; genre1: string | null }>>>(ARTIST_CACHE_MAX_ENTRIES);
const artistStatsLetterBackfillCache = new BoundedMap<string, { expiresAt: number }>(ARTIST_CACHE_MAX_ENTRIES);
const artistStatsLetterBackfillInFlight = new BoundedMap<string, Promise<void>>(ARTIST_CACHE_MAX_ENTRIES);
const artistProjectionRefreshCache = new BoundedMap<string, { expiresAt: number }>(ARTIST_CACHE_MAX_ENTRIES);
const artistProjectionRefreshInFlight = new BoundedMap<string, Promise<void>>(ARTIST_CACHE_MAX_ENTRIES);
let artistsListCache: { expiresAt: number; rows: ArtistRecord[] } | undefined;
let artistsListInFlight: Promise<ArtistRecord[]> | undefined;
let artistSlugLookupCache: { expiresAt: number; rowsBySlug: Map<string, ArtistRecord> } | undefined;
let artistSlugLookupInFlight: Promise<Map<string, ArtistRecord>> | undefined;
const artistSingleSlugCache = new BoundedMap<string, { expiresAt: number; artist: ArtistRecord }>(ARTIST_CACHE_MAX_ENTRIES);
const artistVideosCache = new BoundedMap<string, { expiresAt: number; videos: VideoRecord[] }>(ARTIST_CACHE_MAX_ENTRIES);
const artistVideosInFlight = new BoundedMap<string, Promise<VideoRecord[]>>(ARTIST_CACHE_MAX_ENTRIES);
const knownArtistMatchCache = new BoundedMap<string, { expiresAt: number; known: boolean }>(ARTIST_CACHE_MAX_ENTRIES);
const artistCatalogEvidenceCache = new BoundedMap<string, { expiresAt: number; known: boolean; rockOrMetalGenreMatch: boolean }>(ARTIST_CACHE_MAX_ENTRIES);
let artistVideoStatsSourceCache: "videosbyartist" | "parsedArtist" | undefined;

// ── Cache helpers ─────────────────────────────────────────────────────────────

function getArtistLetterCache(cacheKey: string) {
  const cached = artistLetterCache.get(cacheKey);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    artistLetterCache.delete(cacheKey);
    return undefined;
  }
  return cached.rows;
}

function setArtistLetterCache(cacheKey: string, rows: Array<ArtistRecord & { videoCount: number }>) {
  artistLetterCache.set(cacheKey, {
    expiresAt: Date.now() + ARTIST_LETTER_CACHE_TTL_MS,
    rows,
  });
}

export function clearArtistCaches() {
  artistNormVideoPoolCache.clear();
  artistNormVideoPoolInFlight.clear();
  sameGenreRelatedPoolCache.clear();
  sameGenreRelatedPoolInFlight.clear();
  artistLetterCache.clear();
  artistLetterInFlight.clear();
  artistLetterPageCache.clear();
  artistLetterPageInFlight.clear();
  artistSearchCache.clear();
  artistSearchInFlight.clear();
  artistsListCache = undefined;
  artistsListInFlight = undefined;
  artistVideosCache.clear();
  artistVideosInFlight.clear();
}

export function invalidateArtistLookupCaches() {
  artistsListCache = undefined;
  artistsListInFlight = undefined;
  artistSlugLookupCache = undefined;
  artistSlugLookupInFlight = undefined;
  artistSingleSlugCache.clear();
}

// ── Artist stats projection ───────────────────────────────────────────────────

async function getArtistStatRow(normalizedArtist: string) {
  if (!(await hasArtistStatsProjection())) {
    return null;
  }

  const hasThumbnailColumn = await hasArtistStatsThumbnailColumn();
  const rows = await prisma.$queryRawUnsafe<Array<{
    displayName: string | null;
    country: string | null;
    genre: string | null;
    thumbnailVideoId: string | null;
    videoCount: number | null;
  }>>(
    `
      SELECT
        display_name AS displayName,
        country,
        genre,
        ${hasThumbnailColumn ? "thumbnail_video_id" : "NULL"} AS thumbnailVideoId,
        video_count AS videoCount
      FROM artist_stats
      WHERE normalized_artist = ?
      LIMIT 1
    `,
    normalizedArtist,
  );

  return rows[0] ?? null;
}

async function upsertArtistStatsRow(
  row: { name: string; country: string | null; genre: string | null; videoCount: number; thumbnailVideoId?: string | null },
  source: string,
) {
  if (!(await hasArtistStatsProjection())) {
    return;
  }

  const displayName = row.name.trim();
  if (!displayName) return;

  const normalizedArtist = normalizeArtistKey(displayName);
  const firstLetter = displayName.charAt(0).toUpperCase();
  const slug = slugify(displayName);
  const hasThumbnailColumn = await hasArtistStatsThumbnailColumn();

  if (hasThumbnailColumn) {
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO artist_stats (
          normalized_artist, display_name, slug, first_letter,
          country, genre, thumbnail_video_id, video_count, source, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))
        ON DUPLICATE KEY UPDATE
          display_name = VALUES(display_name),
          slug = VALUES(slug),
          first_letter = VALUES(first_letter),
          country = VALUES(country),
          genre = VALUES(genre),
          thumbnail_video_id = VALUES(thumbnail_video_id),
          video_count = VALUES(video_count),
          source = VALUES(source),
          updated_at = NOW(3)
      `,
      normalizedArtist, displayName, slug, firstLetter,
      row.country, row.genre, row.thumbnailVideoId ?? null, row.videoCount, source,
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO artist_stats (
        normalized_artist, display_name, slug, first_letter,
        country, genre, video_count, source, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))
      ON DUPLICATE KEY UPDATE
        display_name = VALUES(display_name),
        slug = VALUES(slug),
        first_letter = VALUES(first_letter),
        country = VALUES(country),
        genre = VALUES(genre),
        video_count = VALUES(video_count),
        source = VALUES(source),
        updated_at = NOW(3)
    `,
    normalizedArtist, displayName, slug, firstLetter,
    row.country, row.genre, row.videoCount, source,
  );
}

async function batchUpsertArtistStatsRows(
  rows: Array<{ name: string; country: string | null; genre: string | null; videoCount: number; thumbnailVideoId?: string | null }>,
  source: string,
) {
  if (!(await hasArtistStatsProjection())) return;

  const validRows = rows
    .filter((row) => row.videoCount > 0)
    .map((row) => {
      const displayName = row.name.trim();
      if (!displayName) return null;
      return {
        normalizedArtist: normalizeArtistKey(displayName),
        displayName,
        slug: slugify(displayName),
        firstLetter: displayName.charAt(0).toUpperCase(),
        country: row.country,
        genre: row.genre,
        videoCount: row.videoCount,
        thumbnailVideoId: row.thumbnailVideoId ?? null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (validRows.length === 0) return;

  const hasThumbnailColumn = await hasArtistStatsThumbnailColumn();

  for (let offset = 0; offset < validRows.length; offset += BATCH_UPSERT_SIZE) {
    const batch = validRows.slice(offset, offset + BATCH_UPSERT_SIZE);

    if (hasThumbnailColumn) {
      const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
      const params: unknown[] = [];
      for (const row of batch) {
        params.push(row.normalizedArtist, row.displayName, row.slug, row.firstLetter,
          row.country, row.genre, row.thumbnailVideoId, row.videoCount, source);
      }
      await prisma.$executeRawUnsafe(
        `INSERT INTO artist_stats (normalized_artist, display_name, slug, first_letter, country, genre, thumbnail_video_id, video_count, source)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           display_name = VALUES(display_name), slug = VALUES(slug), first_letter = VALUES(first_letter),
           country = VALUES(country), genre = VALUES(genre), thumbnail_video_id = VALUES(thumbnail_video_id),
           video_count = VALUES(video_count), source = VALUES(source)`,
        ...params,
      );
    } else {
      const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
      const params: unknown[] = [];
      for (const row of batch) {
        params.push(row.normalizedArtist, row.displayName, row.slug, row.firstLetter,
          row.country, row.genre, row.videoCount, source);
      }
      await prisma.$executeRawUnsafe(
        `INSERT INTO artist_stats (normalized_artist, display_name, slug, first_letter, country, genre, video_count, source)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           display_name = VALUES(display_name), slug = VALUES(slug), first_letter = VALUES(first_letter),
           country = VALUES(country), genre = VALUES(genre), video_count = VALUES(video_count), source = VALUES(source)`,
        ...params,
      );
    }
  }
}

function scheduleArtistStatsLetterBackfill(letter: string, rows: Array<ArtistRecord & { videoCount: number }>) {
  const normalizedLetter = letter.trim().toUpperCase();
  const now = Date.now();
  const cached = artistStatsLetterBackfillCache.get(normalizedLetter);
  if (cached && cached.expiresAt > now) return;
  if (artistStatsLetterBackfillInFlight.has(normalizedLetter)) return;

  const promise = (async () => {
    await batchUpsertArtistStatsRows(rows.map((r) => ({
      name: r.name,
      country: r.country !== "Unknown" ? r.country : null,
      genre: r.genre !== "Rock / Metal" ? r.genre : null,
      videoCount: r.videoCount,
      thumbnailVideoId: r.thumbnailVideoId,
    })), "runtime-letter-backfill");
    artistStatsLetterBackfillCache.set(normalizedLetter, {
      expiresAt: Date.now() + ARTIST_STATS_LETTER_BACKFILL_TTL_MS,
    });
  })()
    .catch(() => undefined)
    .finally(() => {
      artistStatsLetterBackfillInFlight.delete(normalizedLetter);
    });

  artistStatsLetterBackfillInFlight.set(normalizedLetter, promise);
}

export async function refreshArtistProjectionForName(artistName: string) {
  const displayName = artistName.trim();
  if (!displayName || !hasDatabaseUrl()) return;
  if (!(await hasArtistStatsProjection())) return;

  const normalizedArtist = normalizeArtistKey(displayName);
  const cachedRefresh = artistProjectionRefreshCache.get(normalizedArtist);
  if (cachedRefresh && cachedRefresh.expiresAt > Date.now()) return;

  const inFlightRefresh = artistProjectionRefreshInFlight.get(normalizedArtist);
  if (inFlightRefresh) {
    await inFlightRefresh;
    return;
  }

  const refreshPromise = (async () => {
    const videoArtistNormColumn = await getVideoArtistNormalizationColumn();
    const videoArtistNormExpr = getVideoArtistNormalizationExpr("v", videoArtistNormColumn);
    const videoArtistIndexHint = await getVideoArtistNormalizationIndexHintClause(videoArtistNormColumn);

    // DB-side freshness check: if the projection row was updated recently, skip
    // the expensive COUNT + thumbnail scan and just extend the in-memory cache.
    const freshnessRows = await prisma.$queryRawUnsafe<Array<{ updatedAt: Date | string | null }>>(
      `
        SELECT updated_at AS updatedAt
        FROM artist_stats
        WHERE normalized_artist = ?
        LIMIT 1
      `,
      normalizedArtist,
    );
    const existingUpdatedAt = freshnessRows[0]?.updatedAt;
    if (existingUpdatedAt) {
      const ageMs = Date.now() - new Date(existingUpdatedAt as string | Date).getTime();
      if (ageMs < ARTIST_PROJECTION_REFRESH_TTL_MS) {
        artistProjectionRefreshCache.set(normalizedArtist, {
          expiresAt: Date.now() + ARTIST_PROJECTION_REFRESH_TTL_MS,
        });
        return;
      }
    }

    // AVAILABLE_SITE_VIDEOS_JOIN already deduplicates via SELECT DISTINCT video_id,
    // so each video appears at most once — COUNT(v.id) is equivalent to
    // COUNT(DISTINCT v.videoId) with no extra cost.
    const [countRows, thumbnailRows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ videoCount: number | null }>>(
        `
          SELECT COUNT(v.id) AS videoCount
          FROM videos v${videoArtistIndexHint}
          ${AVAILABLE_SITE_VIDEOS_JOIN}
          WHERE ${videoArtistNormExpr} = ?
            AND v.videoId IS NOT NULL
        `,
        normalizedArtist,
      ),
      prisma.$queryRawUnsafe<Array<{ thumbnailVideoId: string | null }>>(
        `
          SELECT v.videoId AS thumbnailVideoId
          FROM videos v${videoArtistIndexHint}
          ${AVAILABLE_SITE_VIDEOS_JOIN}
          WHERE ${videoArtistNormExpr} = ?
            AND v.videoId IS NOT NULL
          ORDER BY v.id ASC
          LIMIT 1
        `,
        normalizedArtist,
      ),
    ]);

    const videoCount = Number(countRows[0]?.videoCount ?? 0);
    if (videoCount <= 0) {
      await prisma.$executeRawUnsafe(
        "DELETE FROM artist_stats WHERE normalized_artist = ?",
        normalizedArtist,
      );
      return;
    }

    const columns = await getArtistColumnMap();
    const artistNameNormExpr = getArtistNameNormalizationExpr("a", columns);
    const countrySelect = columns.country ? `a.${escapeSqlIdentifier(columns.country)} AS country` : "NULL AS country";
    const genreExpr = columns.genreColumns.length > 0
      ? `COALESCE(${columns.genreColumns.map((column) => `a.${escapeSqlIdentifier(column)}`).join(", ")})`
      : "NULL";

    const artistMetaRows = await prisma.$queryRawUnsafe<Array<{ country: string | null; genre: string | null }>>(
      `
        SELECT ${countrySelect}, ${genreExpr} AS genre
        FROM artists a
        WHERE ${artistNameNormExpr} = ?
        LIMIT 1
      `,
      normalizedArtist,
    );

    const country = artistMetaRows[0]?.country ?? null;
    const genre = artistMetaRows[0]?.genre ?? null;
    const thumbnailVideoId = thumbnailRows[0]?.thumbnailVideoId ?? null;

    await upsertArtistStatsRow({ name: displayName, country, genre, videoCount, thumbnailVideoId }, "runtime");

    artistProjectionRefreshCache.set(normalizedArtist, {
      expiresAt: Date.now() + ARTIST_PROJECTION_REFRESH_TTL_MS,
    });
  })()
    .catch(() => undefined)
    .finally(() => {
      artistProjectionRefreshInFlight.delete(normalizedArtist);
    });

  artistProjectionRefreshInFlight.set(normalizedArtist, refreshPromise);
  await refreshPromise;
}

export function scheduleArtistProjectionRefreshForName(artistName: string) {
  void refreshArtistProjectionForName(artistName).catch(() => undefined);
}

async function hydrateArtistCountryByName(artist: ArtistRecord): Promise<ArtistRecord> {
  if (!hasDatabaseUrl() || artist.country !== "Unknown") return artist;

  try {
    const columns = await getArtistColumnMap();
    if (!columns.country) return artist;

    const nameCol = escapeSqlIdentifier(columns.name);
    const countryCol = escapeSqlIdentifier(columns.country);
    const rows = await prisma.$queryRawUnsafe<Array<{ country: string | null }>>(
      `SELECT a.${countryCol} AS country FROM artists a WHERE a.${nameCol} = ? LIMIT 1`,
      artist.name,
    );

    const country = rows[0]?.country?.trim();
    if (!country) return artist;
    return { ...artist, country };
  } catch {
    return artist;
  }
}

export async function isKnownArtistName(artistName: string) {
  const evidence = await getArtistCatalogEvidence(artistName);
  return evidence.known;
}

export async function getArtistCatalogEvidence(artistName: string) {
  const normalized = artistName.trim().toLowerCase();
  if (!normalized || !hasDatabaseUrl()) {
    return { known: false, rockOrMetalGenreMatch: false };
  }

  const now = Date.now();
  const evidenceCached = artistCatalogEvidenceCache.get(normalized);
  if (evidenceCached && evidenceCached.expiresAt > now) {
    return { known: evidenceCached.known, rockOrMetalGenreMatch: evidenceCached.rockOrMetalGenreMatch };
  }

  const cached = knownArtistMatchCache.get(normalized);
  if (cached && cached.expiresAt > now) {
    return { known: cached.known, rockOrMetalGenreMatch: false };
  }

  try {
    const columns = await getArtistColumnMap();
    const artistNameNormExpr = getArtistNameNormalizationExpr("a", columns);
    const genreExpr = columns.genreColumns.length > 0
      ? `CONCAT_WS(' ', ${columns.genreColumns.map((column) => `a.${escapeSqlIdentifier(column)}`).join(", ")})`
      : "''";

    const rows = await prisma.$queryRawUnsafe<Array<{ matchCount: number; genreBlob: string | null }>>(
      `
        SELECT COUNT(*) AS matchCount, ${genreExpr} AS genreBlob
        FROM artists a
        WHERE ${artistNameNormExpr} = ?
        LIMIT 1
      `,
      normalized,
    );

    const known = Number(rows[0]?.matchCount ?? 0) > 0;
    const genreBlob = (rows[0]?.genreBlob ?? "").trim();
    const rockOrMetalGenreMatch = known && ROCK_METAL_GENRE_PATTERN.test(genreBlob);

    knownArtistMatchCache.set(normalized, { expiresAt: now + KNOWN_ARTIST_MATCH_CACHE_TTL_MS, known });
    artistCatalogEvidenceCache.set(normalized, { expiresAt: now + ARTIST_CATALOG_EVIDENCE_CACHE_TTL_MS, known, rockOrMetalGenreMatch });

    return { known, rockOrMetalGenreMatch };
  } catch {
    return { known: false, rockOrMetalGenreMatch: false };
  }
}

export async function upsertVerifiedExternalArtistCandidate(candidate: {
  name: string;
  country?: string | null;
  genre?: string | null;
  thumbnailVideoId?: string | null;
}) {
  const displayName = candidate.name.trim();
  if (!displayName || !hasDatabaseUrl()) return false;
  if (!(await hasArtistStatsProjection())) return false;

  await refreshArtistProjectionForName(displayName).catch(() => undefined);

  const normalizedArtist = normalizeArtistKey(displayName);
  const existingStat = await getArtistStatRow(normalizedArtist).catch(() => null);
  const existingVideoCount = Number(existingStat?.videoCount ?? 0);

  if (existingVideoCount <= 0) {
    await upsertArtistStatsRow({
      name: displayName,
      country: candidate.country ?? existingStat?.country ?? null,
      genre: candidate.genre ?? existingStat?.genre ?? "Rock / Metal",
      videoCount: 1,
      thumbnailVideoId: candidate.thumbnailVideoId ?? existingStat?.thumbnailVideoId ?? null,
    }, "external-verified");
  }

  invalidateArtistLookupCaches();
  return true;
}

export async function refreshArtistThumbnailForName(artistName: string, badVideoId?: string) {
  const displayName = artistName.trim();
  if (!displayName || !hasDatabaseUrl()) return null;
  if (!(await hasArtistStatsProjection())) return null;

  const normalizedArtist = normalizeArtistKey(displayName);
  const existingStat = await getArtistStatRow(normalizedArtist).catch(() => null);
  const videoArtistNormColumn = await getVideoArtistNormalizationColumn();
  const videoArtistNormExpr = getVideoArtistNormalizationExpr("v", videoArtistNormColumn);
  const videoArtistIndexHint = await getVideoArtistNormalizationIndexHintClause(videoArtistNormColumn);
  const bad = typeof badVideoId === "string" && /^[A-Za-z0-9_-]{11}$/.test(badVideoId) ? badVideoId : null;

  const existingThumbnail = existingStat?.thumbnailVideoId?.trim() ?? null;
  if (existingThumbnail && existingThumbnail !== bad) return existingThumbnail;

  const candidateRows = await prisma.$queryRawUnsafe<Array<{ thumbnailVideoId: string | null }>>(
    `
      SELECT v.videoId AS thumbnailVideoId
      FROM videos v${videoArtistIndexHint}
      ${AVAILABLE_SITE_VIDEOS_JOIN}
      WHERE ${videoArtistNormExpr} = ?
        AND v.videoId IS NOT NULL
        ${bad ? "AND v.videoId <> ?" : ""}
      ORDER BY v.id ASC
      LIMIT 1
    `,
    ...(bad ? [normalizedArtist, bad] : [normalizedArtist]),
  );

  const nextThumbnailVideoId = candidateRows[0]?.thumbnailVideoId ?? null;
  const hasThumbnailColumn = await hasArtistStatsThumbnailColumn();

  if (hasThumbnailColumn) {
    await prisma.$executeRawUnsafe(
      `UPDATE artist_stats SET thumbnail_video_id = ? WHERE normalized_artist = ?`,
      nextThumbnailVideoId,
      normalizedArtist,
    );
  }

  return nextThumbnailVideoId;
}

// ── Video stats source ────────────────────────────────────────────────────────

async function getArtistVideoStatsSource() {
  if (artistVideoStatsSourceCache) return artistVideoStatsSourceCache;

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ hasRows: number }>>(
      "SELECT EXISTS(SELECT 1 FROM videosbyartist LIMIT 1) AS hasRows",
    );
    artistVideoStatsSourceCache = Number(rows[0]?.hasRows ?? 0) > 0 ? "videosbyartist" : "parsedArtist";
  } catch {
    artistVideoStatsSourceCache = "parsedArtist";
  }

  return artistVideoStatsSourceCache;
}

// ── findArtists helpers ───────────────────────────────────────────────────────

export async function findArtistsInDatabase(options: {
  limit: number;
  search?: string;
  orderByName?: boolean;
  prefixOnly?: boolean;
  nameOnly?: boolean;
}) {
  const { limit, search, orderByName, prefixOnly, nameOnly } = options;
  const normalizedSearch = search?.trim() ?? "";
  const normalizedArtistSearch = normalizedSearch ? normalizeArtistKey(normalizedSearch) : "";
  const shouldUseNormalizedPrefixSearch = prefixOnly && normalizedArtistSearch.length > 0;

  if (shouldUseNormalizedPrefixSearch) {
    await ensureArtistSearchPrefixIndex();
  }

  const columns = await getArtistColumnMap();

  const nameCol = escapeSqlIdentifier(columns.name);
  const normalizedNameCol = columns.normalizedName ? escapeSqlIdentifier(columns.normalizedName) : null;
  const countrySelect = columns.country ? `a.${escapeSqlIdentifier(columns.country)} AS country` : "NULL AS country";
  const genreExpr = columns.genreColumns.length > 0
    ? `COALESCE(${columns.genreColumns.map((column) => `a.${escapeSqlIdentifier(column)}`).join(", ")})`
    : "NULL";

  const whereParts: string[] = [];
  const params: string[] = [];

  if (normalizedSearch) {
    const defaultNeedle = prefixOnly ? `${normalizedSearch}%` : `%${normalizedSearch}%`;
    const normalizedNeedle = prefixOnly ? `${normalizedArtistSearch}%` : `%${normalizedArtistSearch}%`;

    if (shouldUseNormalizedPrefixSearch && normalizedNameCol) {
      whereParts.push(`a.${normalizedNameCol} LIKE ?`);
      params.push(normalizedNeedle);
    } else {
      whereParts.push(`a.${nameCol} LIKE ?`);
      params.push(defaultNeedle);
    }

    if (!nameOnly && columns.country) {
      whereParts.push(`a.${escapeSqlIdentifier(columns.country)} LIKE ?`);
      params.push(defaultNeedle);
    }

    if (!nameOnly) {
      for (const genreColumn of columns.genreColumns) {
        whereParts.push(`a.${escapeSqlIdentifier(genreColumn)} LIKE ?`);
        params.push(defaultNeedle);
      }
    }
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" OR ")}` : "";
  const orderSql = orderByName ? `ORDER BY a.${nameCol} ASC` : "";
  const cappedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const searchCacheKey = `s:${normalizedSearch}|l:${cappedLimit}|o:${orderByName ? 1 : 0}|p:${prefixOnly ? 1 : 0}|n:${nameOnly ? 1 : 0}`;

  const executeQuery = async () => {
    if (await hasArtistStatsProjection()) {
      const statNeedle = normalizedSearch ? (prefixOnly ? `${normalizedSearch}%` : `%${normalizedSearch}%`) : null;
      const statNormalizedNeedle = normalizedArtistSearch ? (prefixOnly ? `${normalizedArtistSearch}%` : `%${normalizedArtistSearch}%`) : null;

      const statWhereParts: string[] = [];
      const statParams: string[] = [];

      if (statNeedle) {
        if (prefixOnly && statNormalizedNeedle) {
          statWhereParts.push("s.normalized_artist LIKE ?");
          statParams.push(statNormalizedNeedle);
          if (!nameOnly) {
            statWhereParts.push("s.display_name LIKE ?");
            statParams.push(statNeedle);
          }
        } else {
          statWhereParts.push("s.display_name LIKE ?");
          statParams.push(statNeedle);
        }
        if (!nameOnly) {
          statWhereParts.push("s.country LIKE ?", "s.genre LIKE ?");
          statParams.push(statNeedle, statNeedle);
        }
      }

      const statWhereSql = statWhereParts.length > 0 ? `WHERE ${statWhereParts.join(" OR ")}` : "";
      const statOrderSql = orderByName ? "ORDER BY s.display_name ASC" : "";

      const projectedRows = await prisma.$queryRawUnsafe<Array<{ name: string; country: string | null; genre1: string | null }>>(
        `
          SELECT s.display_name AS name, s.country AS country, s.genre AS genre1
          FROM artist_stats s
          ${statWhereSql}
          ${statOrderSql}
          LIMIT ${cappedLimit}
        `,
        ...statParams,
      );

      if (projectedRows.length > 0 || normalizedSearch.length > 0) {
        return projectedRows;
      }
    }

    return prisma.$queryRawUnsafe<Array<{ name: string; country: string | null; genre1: string | null }>>(
      `
        SELECT a.${nameCol} AS name, ${countrySelect}, ${genreExpr} AS genre1
        FROM artists a
        ${whereSql}
        ${orderSql}
        LIMIT ${cappedLimit}
      `,
      ...params,
    );
  };

  const now = Date.now();
  const cached = artistSearchCache.get(searchCacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.rows.map((row) => ({ ...row }));
  }

  const inFlight = artistSearchInFlight.get(searchCacheKey);
  if (inFlight) {
    const rows = await inFlight;
    return rows.map((row) => ({ ...row }));
  }

  const pending = executeQuery();
  artistSearchInFlight.set(searchCacheKey, pending);

  try {
    const rows = await pending;
    artistSearchCache.set(searchCacheKey, { expiresAt: Date.now() + ARTIST_SEARCH_CACHE_TTL_MS, rows });
    return rows;
  } finally {
    if (artistSearchInFlight.get(searchCacheKey) === pending) {
      artistSearchInFlight.delete(searchCacheKey);
    }
  }
}

export async function findArtistsFromVideoMetadata(search: string, limit: number) {
  const normalizedSearch = search.trim();
  if (!normalizedSearch || !hasDatabaseUrl()) {
    return [] as Array<{ name: string; country: string | null; genre1: string | null }>;
  }

  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const likePattern = `%${normalizedSearch}%`;

  return prisma.$queryRawUnsafe<Array<{ name: string; country: string | null; genre1: string | null }>>(
    `
      SELECT artist_name AS name, NULL AS country, NULL AS genre1
      FROM (
        SELECT
          COALESCE(NULLIF(TRIM(v.parsedArtist), ''), NULLIF(TRIM(v.channelTitle), '')) AS artist_name,
          SUM(COALESCE(v.favourited, 0)) AS artist_score,
          COUNT(*) AS artist_count
        FROM videos v
        ${AVAILABLE_SITE_VIDEOS_JOIN}
        WHERE v.videoId IS NOT NULL
          AND COALESCE(v.approved, 0) = 1
          AND COALESCE(NULLIF(TRIM(v.parsedArtist), ''), NULLIF(TRIM(v.channelTitle), '')) IS NOT NULL
        GROUP BY artist_name
      ) ranked
      WHERE ranked.artist_name LIKE ?
      ORDER BY ranked.artist_score DESC, ranked.artist_count DESC, ranked.artist_name ASC
      LIMIT ${safeLimit}
    `,
    likePattern,
  ).catch(() => []);
}

// ── Artist video pool (for related videos) ────────────────────────────────────

export async function getArtistVideoPoolByNormalizedName(normalizedArtist: string, limit: number): Promise<RankedVideoRow[]> {
  const normalizedArtistKey = normalizedArtist.trim();
  if (!normalizedArtistKey) return [];

  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const cacheKey = normalizedArtistKey;
  const now = Date.now();

  const cached = artistNormVideoPoolCache.get(cacheKey);
  if (cached && cached.expiresAt > now && cached.rows.length >= safeLimit) {
    return cached.rows.slice(0, safeLimit);
  }

  const inFlight = artistNormVideoPoolInFlight.get(cacheKey);
  if (inFlight && inFlight.limit >= safeLimit) {
    const rows = await inFlight.promise;
    return rows.slice(0, safeLimit);
  }

  const resolvePool = async () => {
    const materializedLimit = Math.max(
      ARTIST_NORM_VIDEO_POOL_MIN_ROWS,
      Math.min(ARTIST_NORM_VIDEO_POOL_MAX_ROWS, safeLimit + ARTIST_NORM_VIDEO_POOL_HEADROOM_ROWS),
    );
    const videoArtistNormColumn = await getVideoArtistNormalizationColumn();
    const videoArtistNormExpr = getVideoArtistNormalizationExpr("v", videoArtistNormColumn);
    const videoArtistIndexHint = await getVideoArtistNormalizationIndexHintClause(videoArtistNormColumn);
    const nullCheck = videoArtistNormColumn ? `AND v.${escapeSqlIdentifier(videoArtistNormColumn)} IS NOT NULL` : "";

    const rankedRows = await prisma.$queryRawUnsafe<Array<{ id: number; videoId: string }>>(
      `
        SELECT v.id, v.videoId
        FROM videos v${videoArtistIndexHint}
        ${AVAILABLE_SITE_VIDEOS_JOIN}
        WHERE ${videoArtistNormExpr} = ?
          AND v.videoId IS NOT NULL
          AND COALESCE(v.approved, 0) = 1
          ${nullCheck}
        ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.id DESC
        LIMIT ${materializedLimit}
      `,
      normalizedArtistKey,
    );

    if (rankedRows.length === 0) return [] as RankedVideoRow[];

    const rankedIds = rankedRows.map((row) => row.id);
    const placeholders = rankedIds.map(() => "?").join(", ");
    const details = await prisma.$queryRawUnsafe<Array<{
      id: number;
      videoId: string;
      title: string;
      channelTitle: string | null;
      favourited: number | null;
      description: string | null;
    }>>(
      `
        SELECT v.id, v.videoId, v.title, COALESCE(v.parsedArtist, NULL) AS channelTitle, v.favourited, v.description
        FROM videos v
        WHERE v.id IN (${placeholders})
      `,
      ...rankedIds,
    );

    const detailById = new Map(details.map((row) => [row.id, row]));
    const rows = rankedRows
      .map((ranked) => detailById.get(ranked.id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .map((row) => ({
        videoId: row.videoId,
        title: row.title,
        channelTitle: row.channelTitle,
        favourited: Number(row.favourited ?? 0),
        description: row.description,
      }));

    artistNormVideoPoolCache.set(cacheKey, {
      expiresAt: Date.now() + ARTIST_NORM_VIDEO_POOL_CACHE_TTL_MS,
      rows,
    });

    return rows;
  };

  const pending = resolvePool();
  artistNormVideoPoolInFlight.set(cacheKey, { limit: safeLimit, promise: pending });

  try {
    const rows = await pending;
    return rows.slice(0, safeLimit);
  } finally {
    if (artistNormVideoPoolInFlight.get(cacheKey)?.promise === pending) {
      artistNormVideoPoolInFlight.delete(cacheKey);
    }
  }
}

export async function getSameGenreRelatedPoolByArtist(normalizedArtist: string, limit: number): Promise<RankedVideoRow[]> {
  const safeLimit = Math.max(1, Math.min(160, Math.floor(limit)));
  const cacheKey = normalizedArtist;
  const now = Date.now();

  const cached = sameGenreRelatedPoolCache.get(cacheKey);
  if (cached && cached.expiresAt > now && cached.rows.length >= safeLimit) {
    return cached.rows.slice(0, safeLimit);
  }

  const inFlight = sameGenreRelatedPoolInFlight.get(cacheKey);
  if (inFlight) {
    const rows = await inFlight;
    return rows.slice(0, safeLimit);
  }

  const resolvePool = async () => {
    const artistColumns = await getArtistColumnMap();
    if (artistColumns.genreColumns.length === 0) return [] as RankedVideoRow[];

    const artistNameNormExpr = getArtistNameNormalizationExpr("a", artistColumns);
    const videoArtistNormColumn = await getVideoArtistNormalizationColumn();
    const videoArtistNormExpr = getVideoArtistNormalizationExpr("v", videoArtistNormColumn);
    const genreExpr = `COALESCE(${artistColumns.genreColumns.map((column) => `a.${escapeSqlIdentifier(column)}`).join(", ")})`;

    const currentArtistGenreRows = await prisma.$queryRawUnsafe<Array<{ genre: string | null }>>(
      `SELECT ${genreExpr} AS genre FROM artists a WHERE ${artistNameNormExpr} = ? LIMIT 1`,
      normalizedArtist,
    );

    const genre = currentArtistGenreRows[0]?.genre?.trim();
    if (!genre) return [] as RankedVideoRow[];

    const genrePredicate = artistColumns.genreColumns
      .map((column) => `a.${escapeSqlIdentifier(column)} LIKE CONCAT('%', ?, '%')`)
      .join(" OR ");
    const genreParams = artistColumns.genreColumns.map(() => genre);

    const sameGenreArtistRows = await prisma.$queryRawUnsafe<Array<{ normalizedArtist: string | null }>>(
      `
        SELECT DISTINCT ${artistNameNormExpr} AS normalizedArtist
        FROM artists a
        WHERE ${artistNameNormExpr} IS NOT NULL
          AND ${artistNameNormExpr} <> ?
          AND (${genrePredicate})
        LIMIT 160
      `,
      normalizedArtist,
      ...genreParams,
    );

    const sameGenreArtistKeys = [...new Set(
      sameGenreArtistRows
        .map((row) => row.normalizedArtist?.trim())
        .filter((value): value is string => Boolean(value)),
    )].slice(0, 120);

    if (sameGenreArtistKeys.length === 0) return [] as RankedVideoRow[];

    const placeholders = sameGenreArtistKeys.map(() => "?").join(", ");
    const materializedLimit = Math.max(80, safeLimit);

    const rows = await prisma.$queryRawUnsafe<RankedVideoRow[]>(
      `
        SELECT /*+ MAX_EXECUTION_TIME(800) */
          v.videoId, v.title, COALESCE(v.parsedArtist, NULL) AS channelTitle, v.favourited, v.description
        FROM videos v
        ${AVAILABLE_SITE_VIDEOS_JOIN}
        WHERE v.videoId IS NOT NULL
          AND COALESCE(v.approved, 0) = 1
          AND ${videoArtistNormExpr} IN (${placeholders})
        ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.id DESC
        LIMIT ${materializedLimit}
      `,
      ...sameGenreArtistKeys,
    );

    const deduped = dedupeRankedRows(rows);
    sameGenreRelatedPoolCache.set(cacheKey, { expiresAt: Date.now() + SAME_GENRE_RELATED_POOL_CACHE_TTL_MS, rows: deduped });
    return deduped;
  };

  const pending = resolvePool();
  sameGenreRelatedPoolInFlight.set(cacheKey, pending);

  try {
    const rows = await pending;
    return rows.slice(0, safeLimit);
  } finally {
    if (sameGenreRelatedPoolInFlight.get(cacheKey) === pending) {
      sameGenreRelatedPoolInFlight.delete(cacheKey);
    }
  }
}

// ── Public artist queries ─────────────────────────────────────────────────────

export async function getArtistSlugsForSitemap(offset: number, limit: number, minVideoCount = 2): Promise<string[]> {
  if (!hasDatabaseUrl()) return seedArtists.map((a) => a.slug).slice(offset, offset + limit);
  try {
    if (await hasArtistStatsProjection()) {
      const rows = await prisma.$queryRawUnsafe<Array<{ slug: string }>>(
        `SELECT slug FROM artist_stats WHERE video_count >= ? ORDER BY video_count DESC, slug ASC LIMIT ? OFFSET ?`,
        minVideoCount,
        limit,
        offset,
      );
      return rows.map((r) => r.slug);
    }
    const rows = await prisma.$queryRaw<Array<{ slug: string }>>`
      SELECT slug FROM artists WHERE slug IS NOT NULL ORDER BY slug ASC LIMIT ${limit} OFFSET ${offset}
    `;
    return rows.map((r) => r.slug);
  } catch {
    return [];
  }
}

export async function getArtists() {
  if (!hasDatabaseUrl()) return seedArtists;

  const now = Date.now();
  if (artistsListCache && artistsListCache.expiresAt > now) return artistsListCache.rows;
  if (artistsListInFlight) return artistsListInFlight;

  const resolveArtists = async () => {
    try {
      if (await hasArtistStatsProjection()) {
        const hasThumbnailColumn = await hasArtistStatsThumbnailColumn();
        const thumbnailSelect = hasThumbnailColumn ? "s.thumbnail_video_id AS thumbnailVideoId" : "NULL AS thumbnailVideoId";
        const rows = await prisma.$queryRawUnsafe<Array<{
          displayName: string; slug: string; country: string | null; genre: string | null; thumbnailVideoId: string | null;
        }>>(
          `
            SELECT s.display_name AS displayName, s.slug, s.country, s.genre, ${thumbnailSelect}
            FROM artist_stats s
            WHERE s.video_count > 0
            ORDER BY s.display_name ASC
            LIMIT 24
          `,
        );

        if (rows.length > 0) return rows.map(mapArtistProjectionRow);
      }

      const artists = await findArtistsInDatabase({ limit: 24, orderByName: true });
      return artists.length > 0 ? artists.map(mapArtist) : seedArtists;
    } catch {
      return seedArtists;
    }
  };

  const pending = resolveArtists();
  artistsListInFlight = pending;

  try {
    const rows = await pending;
    artistsListCache = { expiresAt: Date.now() + ARTISTS_LIST_CACHE_TTL_MS, rows };
    return rows;
  } finally {
    if (artistsListInFlight === pending) {
      artistsListInFlight = undefined;
    }
  }
}

export async function getArtistsByLetter(letter: string, limit = 120, offset = 0, filterPrefix = ""): Promise<Array<ArtistRecord & { videoCount: number }>> {
  const normalizedLetter = letter.trim().toUpperCase();
  const normalizedFilterPrefix = filterPrefix.trim().toLowerCase();
  const safeLimit = Math.max(1, Math.min(limit, 300));
  const safeOffset = Math.max(0, Math.floor(offset));
  const letterFilterPrefix = normalizedFilterPrefix || normalizedLetter.toLowerCase();
  const projectionPageCacheKey = `${normalizedLetter}:${letterFilterPrefix}:${safeOffset}:${safeLimit}`;

  const countFromSeed = (artistName: string) => {
    const normalizedName = artistName.trim().toLowerCase();
    return seedVideos.filter((video) =>
      video.channelTitle.toLowerCase().includes(normalizedName) ||
      video.title.toLowerCase().includes(normalizedName),
    ).length;
  };

  if (!/^[A-Z]$/.test(normalizedLetter)) return [];

  if (!hasDatabaseUrl()) {
    return seedArtists
      .filter((artist) => artist.name.trim().toLowerCase().startsWith(letterFilterPrefix))
      .slice(safeOffset, safeOffset + safeLimit)
      .map((artist) => ({ ...artist, videoCount: countFromSeed(artist.name) }))
      .filter((artist) => artist.videoCount > 0);
  }

  try {
    if (await hasArtistStatsProjection()) {
      const now = Date.now();
      const cachedPage = artistLetterPageCache.get(projectionPageCacheKey);
      if (cachedPage && cachedPage.expiresAt > now) return cachedPage.rows;

      const inFlight = artistLetterPageInFlight.get(projectionPageCacheKey);
      if (inFlight) return await inFlight;

      const hasThumbnailColumn = await hasArtistStatsThumbnailColumn();
      const queryPromise = (async () => {
        const projectedRows = await prisma.$queryRawUnsafe<Array<{
          displayName: string; slug: string; country: string | null; genre: string | null;
          videoCount: number | null; thumbnailVideoId: string | null;
        }>>(
          `
            SELECT s.display_name AS displayName, s.slug, s.country, s.genre,
                   s.video_count AS videoCount,
                   ${hasThumbnailColumn ? "s.thumbnail_video_id" : "NULL"} AS thumbnailVideoId
            FROM artist_stats s
            WHERE s.first_letter = ?
              AND LOWER(s.display_name) LIKE ?
              AND s.video_count > 0
            ORDER BY s.display_name ASC
            LIMIT ${safeLimit}
            OFFSET ${safeOffset}
          `,
          normalizedLetter,
          `${letterFilterPrefix}%`,
        );

        if (projectedRows.length > 0 || safeOffset > 0) {
          const mapped = projectedRows.map((row) => ({
            ...mapArtistProjectionRow(row),
            videoCount: Number(row.videoCount ?? 0),
          }));
          artistLetterPageCache.set(projectionPageCacheKey, {
            expiresAt: Date.now() + ARTIST_LETTER_PAGE_CACHE_TTL_MS,
            rows: mapped,
          });
          return mapped;
        }
        return [];
      })();

      artistLetterPageInFlight.set(projectionPageCacheKey, queryPromise);
      const projected = await queryPromise.finally(() => {
        artistLetterPageInFlight.delete(projectionPageCacheKey);
      });

      if (projected.length > 0 || safeOffset > 0) return projected;
    }

    const columns = await getArtistColumnMap();
    const statsSource = await getArtistVideoStatsSource();
    const letterCacheKey = `${statsSource}:${normalizedLetter}:${letterFilterPrefix}`;

    if (statsSource === "parsedArtist") {
      const cachedRows = getArtistLetterCache(letterCacheKey);
      if (cachedRows) return cachedRows.slice(safeOffset, safeOffset + safeLimit);

      const inFlightRows = artistLetterInFlight.get(letterCacheKey);
      if (inFlightRows) {
        const sharedRows = await inFlightRows;
        return sharedRows.slice(safeOffset, safeOffset + safeLimit);
      }
    }

    const nameCol = escapeSqlIdentifier(columns.name);
    const artistNameNormExpr = getArtistNameNormalizationExpr("a", columns);
    const countrySelect = columns.country ? `a.${escapeSqlIdentifier(columns.country)} AS country` : "NULL AS country";
    const videoArtistNormColumn = await getVideoArtistNormalizationColumn();
    const videoArtistNormExpr = getVideoArtistNormalizationExpr("v", videoArtistNormColumn);
    const genreExpr = columns.genreColumns.length > 0
      ? `COALESCE(${columns.genreColumns.map((column) => `a.${escapeSqlIdentifier(column)}`).join(", ")})`
      : "NULL";

    if (statsSource === "parsedArtist") {
      const buildRowsPromise = (async () => {
        const artists = await prisma.$queryRawUnsafe<Array<{ name: string; country: string | null; genre1: string | null }>>(
          `
            SELECT a.${nameCol} AS name, NULL AS country, ${genreExpr} AS genre1
            FROM artists a
            WHERE a.${nameCol} IS NOT NULL AND a.${nameCol} <> ''
              AND ${artistNameNormExpr} LIKE ?
            ORDER BY a.${nameCol} ASC
          `,
          `${letterFilterPrefix}%`,
        );

        const parsedArtistCounts = await prisma.$queryRawUnsafe<Array<{ artistKey: string | null; videoCount: number | null; thumbnailVideoId: string | null }>>(
          `
            SELECT
              ${videoArtistNormExpr} AS artistKey,
              COUNT(DISTINCT v.videoId) AS videoCount,
              SUBSTRING_INDEX(GROUP_CONCAT(v.videoId ORDER BY v.id ASC), ',', 1) AS thumbnailVideoId
            FROM videos v
            ${AVAILABLE_SITE_VIDEOS_JOIN}
            WHERE ${videoArtistNormExpr} <> ''
              AND v.videoId IS NOT NULL
              AND ${videoArtistNormExpr} LIKE ?
            GROUP BY ${videoArtistNormExpr}
          `,
          `${letterFilterPrefix}%`,
        );

        const countByArtist = new Map<string, number>();
        const thumbnailByArtist = new Map<string, string>();
        for (const row of parsedArtistCounts) {
          const key = row.artistKey?.trim();
          if (!key) continue;
          countByArtist.set(key, (countByArtist.get(key) ?? 0) + Number(row.videoCount ?? 0));
          if (row.thumbnailVideoId) thumbnailByArtist.set(key, row.thumbnailVideoId);
        }

        const rows = artists
          .map((row) => {
            const key = normalizeArtistKey(row.name);
            return { ...mapArtist(row), videoCount: countByArtist.get(key) ?? 0, thumbnailVideoId: thumbnailByArtist.get(key) };
          })
          .filter((artist) => artist.videoCount > 0);

        setArtistLetterCache(letterCacheKey, rows);
        scheduleArtistStatsLetterBackfill(normalizedLetter, rows);
        return rows;
      })();

      artistLetterInFlight.set(letterCacheKey, buildRowsPromise);

      try {
        const rows = await buildRowsPromise;
        return rows.slice(safeOffset, safeOffset + safeLimit);
      } finally {
        if (artistLetterInFlight.get(letterCacheKey) === buildRowsPromise) {
          artistLetterInFlight.delete(letterCacheKey);
        }
      }
    }

    let videoCountSubquery = `
      SELECT
        ${videoArtistNormExpr} AS artistKey,
        COUNT(DISTINCT v.videoId) AS videoCount,
        SUBSTRING_INDEX(GROUP_CONCAT(v.videoId ORDER BY v.id ASC), ',', 1) AS thumbnailVideoId
      FROM videos v
      WHERE ${videoArtistNormExpr} <> ''
        AND v.videoId IS NOT NULL
        AND ${videoArtistNormExpr} LIKE ?
      GROUP BY ${videoArtistNormExpr}
    `;

    if (statsSource === "videosbyartist") {
      const artistVideoColumns = await getArtistVideoColumnMap();
      const vaArtistCol = escapeSqlIdentifier(artistVideoColumns.artistName);
      const vaArtistNormExpr = artistVideoColumns.normalizedArtistName
        ? `va.${escapeSqlIdentifier(artistVideoColumns.normalizedArtistName)}`
        : `LOWER(TRIM(COALESCE(va.${vaArtistCol}, '')))`;
      const vaVideoRefCol = escapeSqlIdentifier(artistVideoColumns.videoRef);
      const joinVideoExpr = artistVideoColumns.joinsOnVideoPrimaryId ? "v.id" : "v.videoId";

      videoCountSubquery = `
        SELECT
          ${vaArtistNormExpr} AS artistKey,
          COUNT(DISTINCT v.videoId) AS videoCount,
          SUBSTRING_INDEX(GROUP_CONCAT(v.videoId ORDER BY v.id ASC), ',', 1) AS thumbnailVideoId
        FROM videosbyartist va
        INNER JOIN videos v ON ${joinVideoExpr} = va.${vaVideoRefCol}
        WHERE ${vaArtistNormExpr} <> ''
          AND ${vaArtistNormExpr} LIKE ?
          AND EXISTS (
            SELECT 1 FROM site_videos sv
            WHERE sv.video_id = v.id AND sv.status = 'available'
          )
          AND v.videoId IS NOT NULL
        GROUP BY ${vaArtistNormExpr}
      `;
    }

    const rows = await prisma.$queryRawUnsafe<Array<{
      name: string; country: string | null; genre1: string | null;
      videoCount: number | null; thumbnailVideoId: string | null;
    }>>(
      `
        SELECT a.${nameCol} AS name, ${countrySelect}, ${genreExpr} AS genre1,
               vc.videoCount AS videoCount, vc.thumbnailVideoId AS thumbnailVideoId
        FROM artists a
        INNER JOIN (${videoCountSubquery}) vc ON vc.artistKey = ${artistNameNormExpr}
        WHERE vc.videoCount > 0
          AND a.${nameCol} IS NOT NULL AND a.${nameCol} <> ''
          AND ${artistNameNormExpr} LIKE ?
        ORDER BY a.${nameCol} ASC
        LIMIT ${safeLimit}
        OFFSET ${safeOffset}
      `,
      `${letterFilterPrefix}%`,
      `${letterFilterPrefix}%`,
    );

    const mappedRows = rows.map((row) => ({
      ...mapArtist(row),
      videoCount: Number(row.videoCount ?? 0),
      thumbnailVideoId: row.thumbnailVideoId ?? undefined,
    }));
    scheduleArtistStatsLetterBackfill(normalizedLetter, mappedRows);
    return mappedRows;
  } catch {
    return seedArtists
      .filter((artist) => artist.name.trim().toLowerCase().startsWith(letterFilterPrefix))
      .slice(safeOffset, safeOffset + safeLimit)
      .map((artist) => ({ ...artist, videoCount: countFromSeed(artist.name) }))
      .filter((artist) => artist.videoCount > 0);
  }
}

export async function getArtistBySlug(slug: string) {
  if (!hasDatabaseUrl()) return getSeedArtistBySlug(slug);

  try {
    if (await hasArtistStatsProjection()) {
      const rows = await prisma.$queryRawUnsafe<Array<{
        displayName: string; slug: string; country: string | null; genre: string | null;
      }>>(
        `SELECT display_name AS displayName, slug, country, genre FROM artist_stats WHERE slug = ? LIMIT 1`,
        slug,
      );
      if (rows.length > 0) return mapArtistProjectionRow(rows[0]);
    }

    const now = Date.now();
    if (artistSlugLookupCache && artistSlugLookupCache.expiresAt > now) {
      return artistSlugLookupCache.rowsBySlug.get(slug) ?? getSeedArtistBySlug(slug);
    }

    const singleCached = artistSingleSlugCache.get(slug);
    if (singleCached && singleCached.expiresAt > now) return singleCached.artist;

    const slugTerms = slug.trim().toLowerCase().split("-")
      .map((part) => part.trim()).filter((part) => part.length > 0).slice(0, 8);

    if (slugTerms.length > 0) {
      const columns = await getArtistColumnMap();
      const nameCol = escapeSqlIdentifier(columns.name);
      const genreExpr = columns.genreColumns.length > 0
        ? `COALESCE(${columns.genreColumns.map((column) => `a.${escapeSqlIdentifier(column)}`).join(", ")})`
        : "NULL";

      const termPredicates = slugTerms.map(() => `LOWER(a.${nameCol}) LIKE ?`).join(" AND ");
      const termParams = slugTerms.map((term) => `%${term}%`);

      const narrowed = await prisma.$queryRawUnsafe<Array<{ name: string; country: string | null; genre1: string | null }>>(
        `
          SELECT a.${nameCol} AS name, NULL AS country, ${genreExpr} AS genre1
          FROM artists a
          WHERE a.${nameCol} IS NOT NULL AND a.${nameCol} <> ''
            AND ${termPredicates}
          ORDER BY a.${nameCol} ASC
          LIMIT 400
        `,
        ...termParams,
      );

      const fastMatch = narrowed.find((artist) => slugify(artist.name) === slug);
      if (fastMatch) {
        const mapped = await hydrateArtistCountryByName(mapArtist(fastMatch));
        artistSingleSlugCache.set(slug, { expiresAt: Date.now() + ARTIST_SINGLE_SLUG_CACHE_TTL_MS, artist: mapped });
        return mapped;
      }
    }

    if (!artistSlugLookupInFlight) {
      artistSlugLookupInFlight = (async () => {
        const columns = await getArtistColumnMap();
        const nameCol = escapeSqlIdentifier(columns.name);
        const genreExpr = columns.genreColumns.length > 0
          ? `COALESCE(${columns.genreColumns.map((column) => `a.${escapeSqlIdentifier(column)}`).join(", ")})`
          : "NULL";
        const slugStart = slug.match(/[a-z0-9]/i)?.[0]?.toLowerCase() ?? "";
        const slugPrefix = slugStart ? `${slugStart}%` : "%";

        const pageSize = 2000;
        let offset = 0;
        let matchedCandidate: { name: string; country: string | null; genre1: string | null } | undefined;

        while (!matchedCandidate) {
          const candidates = await prisma.$queryRawUnsafe<Array<{ name: string; country: string | null; genre1: string | null }>>(
            `
              SELECT a.${nameCol} AS name, NULL AS country, ${genreExpr} AS genre1
              FROM artists a
              WHERE a.${nameCol} IS NOT NULL AND a.${nameCol} <> ''
                AND LOWER(a.${nameCol}) LIKE ?
              ORDER BY a.${nameCol} ASC
              LIMIT ${pageSize}
              OFFSET ${offset}
            `,
            slugPrefix,
          );

          matchedCandidate = candidates.find((artist) => slugify(artist.name) === slug);
          if (matchedCandidate || candidates.length < pageSize) break;
          offset += pageSize;
        }

        const rowsBySlug = new Map<string, ArtistRecord>();
        if (matchedCandidate) rowsBySlug.set(slug, mapArtist(matchedCandidate));
        return rowsBySlug;
      })().finally(() => {
        artistSlugLookupInFlight = undefined;
      });
    }

    const rowsBySlug = await artistSlugLookupInFlight;
    const matched = rowsBySlug.get(slug);
    if (!matched) return getSeedArtistBySlug(slug);

    const hydrated = await hydrateArtistCountryByName(matched);
    artistSingleSlugCache.set(slug, {
      expiresAt: Date.now() + ARTIST_SINGLE_SLUG_CACHE_TTL_MS,
      artist: hydrated,
    });
    return hydrated;
  } catch {
    return getSeedArtistBySlug(slug);
  }
}

export async function getVideosByArtist(artistName: string, limit = 500) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const normalizedArtist = normalizeArtistKey(artistName);
  if (!normalizedArtist) return [] as VideoRecord[];

  const cacheKey = `${normalizedArtist}:${safeLimit}`;
  const now = Date.now();
  const cached = artistVideosCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.videos;

  const inFlight = artistVideosInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const resolveVideos = async () => {
    if (!hasDatabaseUrl()) {
      const fallback = seedVideos
        .filter((video) =>
          video.channelTitle.toLowerCase().includes(normalizedArtist) ||
          video.title.toLowerCase().includes(normalizedArtist),
        )
        .slice(0, safeLimit);
      artistVideosCache.set(cacheKey, { expiresAt: Date.now() + ARTIST_VIDEOS_CACHE_TTL_MS, videos: fallback });
      return fallback;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapVideo: (row: any) => VideoRecord = (row) => ({
      id: row.videoId,
      title: row.title,
      channelTitle: row.parsedArtist || artistName,
      genre: "Rock / Metal",
      favourited: Number(row.favourited ?? 0),
      description: row.description ?? "Legacy video entry from the retained Yeh database.",
    });

    try {
      const videoArtistNormColumn = await getVideoArtistNormalizationColumn();
      const videoArtistNormExpr = getVideoArtistNormalizationExpr("v", videoArtistNormColumn);
      const conflictingArtistNormExpr = getVideoArtistNormalizationExpr("v_conflict", videoArtistNormColumn);
      const videoArtistIndexHint = await getVideoArtistNormalizationIndexHintClause(videoArtistNormColumn);

      const query = `
        SELECT
          v.videoId,
          v.title,
          NULLIF(TRIM(v.parsedArtist), '') AS parsedArtist,
          v.favourited,
          v.description
        FROM videos v${videoArtistIndexHint}
        ${AVAILABLE_SITE_VIDEOS_JOIN}
        WHERE ${videoArtistNormExpr} = ?
          AND v.videoId IS NOT NULL
          AND COALESCE(v.approved, 0) = 1
          AND NOT EXISTS (
            SELECT 1
            FROM videos v_conflict
            WHERE v_conflict.videoId = v.videoId
              AND v_conflict.videoId IS NOT NULL
              AND ${conflictingArtistNormExpr} <> ''
              AND ${conflictingArtistNormExpr} <> ?
          )
        ORDER BY COALESCE(v.viewCount, 0) DESC, v.id ASC
        LIMIT ${safeLimit}
      `;

      const rows = await prisma.$queryRawUnsafe<Array<{
        videoId: string; title: string; parsedArtist: string | null; favourited: number; description: string | null;
      }>>(query, normalizedArtist, normalizedArtist);

      const mapped = rows
        .map(mapVideo)
        .filter((video, index, allVideos) => allVideos.findIndex((candidate) => candidate.id === video.id) === index);

      artistVideosCache.set(cacheKey, { expiresAt: Date.now() + ARTIST_VIDEOS_CACHE_TTL_MS, videos: mapped });

      // Reconcile projection in the background
      void (async () => {
        try {
          if (await hasArtistStatsProjection()) {
            const projectionRows = await prisma.$queryRawUnsafe<Array<{ videoCount: number | null }>>(
              `SELECT video_count AS videoCount FROM artist_stats WHERE normalized_artist = ? LIMIT 1`,
              normalizedArtist,
            );
            const projectedCount = Number(projectionRows[0]?.videoCount ?? 0);
            if (projectedCount !== mapped.length) {
              await refreshArtistProjectionForName(artistName).catch(() => undefined);
            }
            return;
          }
          if (mapped.length === 0) {
            await refreshArtistProjectionForName(artistName).catch(() => undefined);
          }
        } catch {
          // best-effort reconciliation only
        }
      })();

      return mapped;
    } catch {
      const fallback = seedVideos
        .filter((video) =>
          video.channelTitle.toLowerCase().includes(normalizedArtist) ||
          video.title.toLowerCase().includes(normalizedArtist),
        )
        .slice(0, safeLimit);
      artistVideosCache.set(cacheKey, { expiresAt: Date.now() + ARTIST_VIDEOS_CACHE_TTL_MS, videos: fallback });
      return fallback;
    }
  };

  const pending = resolveVideos();
  artistVideosInFlight.set(cacheKey, pending);

  try {
    return await pending;
  } finally {
    if (artistVideosInFlight.get(cacheKey) === pending) {
      artistVideosInFlight.delete(cacheKey);
    }
  }
}
