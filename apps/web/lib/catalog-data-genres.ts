/**
 * catalog-data-genres.ts
 * Genre / category domain: genre list, genre cards, artists-by-genre, videos-by-genre.
 */

import { prisma } from "@/lib/db";
import { BoundedMap } from "@/lib/bounded-map";
import type { ArtistRecord, VideoRecord } from "@/lib/catalog";
import {
  dedupeRankedRows,
  escapeSqlIdentifier,
  getGenreSlug,
  hasDatabaseUrl,
  mapArtist,
  mapVideo,
  normalizeArtistKey,
  normalizeYouTubeVideoId,
  seedArtists,
  seedGenres,
  seedVideos,
  withSoftTimeout,
  type GenreCard,
  type RankedVideoRow,
} from "@/lib/catalog-data-utils";
import {
  AVAILABLE_SITE_VIDEOS_JOIN,
  getArtistColumnMap,
  getArtistNameNormalizationExpr,
  getVideoArtistNormalizationColumn,
  getVideoArtistNormalizationExpr,
  getVideoArtistNormalizationIndexHintClause,
} from "@/lib/catalog-data-db";

// ── Constants ─────────────────────────────────────────────────────────────────

const GENRE_RESULTS_CACHE_TTL_MS = 5 * 60 * 1000;
const GENRE_CARDS_CACHE_TTL_MS = 30 * 1000;
const CATEGORY_QUERY_TIMEOUT_MS = 2_500;
const GENRE_CACHE_MAX_ENTRIES = Math.max(
  100,
  Math.min(2_000, Number(process.env.GENRE_CACHE_MAX_ENTRIES || "600")),
);

// ── Caches ────────────────────────────────────────────────────────────────────

const genreArtistsCache = new BoundedMap<string, { expiresAt: number; artists: ArtistRecord[] }>(GENRE_CACHE_MAX_ENTRIES);
const genreVideosCache = new BoundedMap<string, { expiresAt: number; videos: VideoRecord[] }>(GENRE_CACHE_MAX_ENTRIES);
const genreVideosInFlight = new BoundedMap<string, Promise<VideoRecord[]>>(GENRE_CACHE_MAX_ENTRIES);
let genreCardsCache: { expiresAt: number; cards: GenreCard[] } | undefined;
let genreCardsInFlight: Promise<GenreCard[]> | undefined;
let genreListCache: { expiresAt: number; genres: string[] } | undefined;

// ── Cache clearing ────────────────────────────────────────────────────────────

function resetGenreCardCaches() {
  genreCardsCache = undefined;
  genreListCache = undefined;
}

export function clearGenreCaches() {
  genreArtistsCache.clear();
  genreVideosCache.clear();
  genreVideosInFlight.clear();
  genreCardsCache = undefined;
  genreCardsInFlight = undefined;
  genreListCache = undefined;
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
    if (Number(cleared) > 0) {
      resetGenreCardCaches();
    }
  } catch {
    // best effort only
  }
}

// ── Genre queries ─────────────────────────────────────────────────────────────

export async function getGenres() {
  if (!hasDatabaseUrl()) return seedGenres;

  const now = Date.now();
  if (genreListCache && genreListCache.expiresAt > now) return genreListCache.genres;

  try {
    const rows = await prisma.$queryRaw<Array<{ genre: string }>>`
      SELECT genre FROM genre_cards ORDER BY genre ASC LIMIT 1000
    `;

    if (rows.length > 0) {
      const genres = rows.map((r) => r.genre);
      genreListCache = { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, genres };
      return genres;
    }

    const fallbackRows = await prisma.$queryRaw<Array<{ genre: string }>>`
      SELECT name AS genre FROM genres WHERE name IS NOT NULL AND TRIM(name) <> '' ORDER BY name ASC LIMIT 500
    `;
    const genres = fallbackRows.map((r) => r.genre);
    genreListCache = { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, genres };
    return genres;
  } catch {
    return genreListCache?.genres ?? [];
  }
}

export async function getGenreCards(): Promise<GenreCard[]> {
  if (!hasDatabaseUrl()) {
    return seedGenres.map((genre) => ({ genre, previewVideoId: null }));
  }

  const now = Date.now();
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

      let cards: GenreCard[] = rows.map((row) => ({
        genre: row.genre,
        previewVideoId: row.thumbnailVideoId ?? row.thumbnail_video_id ?? null,
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
          cards = fallbackRows.map((r) => ({
            genre: r.genre,
            previewVideoId: r.thumbnailVideoId ?? r.thumbnail_video_id ?? null,
          }));
        } else {
          const genreRows = await prisma.$queryRaw<Array<{ genre: string }>>`
            SELECT name AS genre FROM genres WHERE name IS NOT NULL AND TRIM(name) <> '' ORDER BY name ASC LIMIT 1000
          `;
          cards = genreRows.map((r) => ({ genre: r.genre, previewVideoId: null }));
        }
      }

      if (cards.length === 0) {
        cards = (await getGenres()).map((genre) => ({ genre, previewVideoId: null }));
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

      genreCardsCache = { expiresAt: now + GENRE_CARDS_CACHE_TTL_MS, cards };
      genreListCache = { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, genres: cards.map((c) => c.genre) };
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
          const fallbackCards = rawFallbackRows.map((row) => ({
            genre: row.genre,
            previewVideoId: row.thumbnailVideoId ?? row.thumbnail_video_id ?? null,
          }));
          genreCardsCache = { expiresAt: now + 30_000, cards: fallbackCards };
          return fallbackCards;
        }
      } catch {
        // fall through
      }

      const fallbackCards = (await getGenres()).map((genre) => ({ genre, previewVideoId: null }));
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
  const genres = await getGenres();
  return genres.find((genre) => getGenreSlug(genre) === slug);
}

// ── Artists by genre ──────────────────────────────────────────────────────────

function getArtistsByGenreFallback(genre: string) {
  return seedArtists.filter((artist) =>
    artist.genre.toLowerCase().includes(genre.toLowerCase()),
  );
}

export async function getArtistsByGenre(genre: string) {
  const cacheKey = genre.trim().toLowerCase();
  const now = Date.now();
  const cached = genreArtistsCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.artists;

  if (!hasDatabaseUrl()) {
    const fallback = getArtistsByGenreFallback(genre);
    genreArtistsCache.set(cacheKey, { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, artists: fallback });
    return fallback;
  }

  try {
    const useFulltext = genre.trim().length >= 3;

    const artists = useFulltext
      ? await prisma.$queryRaw<Array<{ name: string; country: string | null; genre1: string | null }>>`
          SELECT a.artist AS name, a.country,
                 COALESCE(a.genre1, a.genre2, a.genre3, a.genre4, a.genre5, a.genre6) AS genre1
          FROM artists a
          WHERE MATCH(a.genre_all) AGAINST (${genre} IN BOOLEAN MODE)
        `
      : await prisma.$queryRaw<Array<{ name: string; country: string | null; genre1: string | null }>>`
          SELECT a.artist AS name, a.country,
                 COALESCE(a.genre1, a.genre2, a.genre3, a.genre4, a.genre5, a.genre6) AS genre1
          FROM artists a
          WHERE (
            a.genre1 LIKE CONCAT('%', ${genre}, '%') OR
            a.genre2 LIKE CONCAT('%', ${genre}, '%') OR
            a.genre3 LIKE CONCAT('%', ${genre}, '%') OR
            a.genre4 LIKE CONCAT('%', ${genre}, '%') OR
            a.genre5 LIKE CONCAT('%', ${genre}, '%') OR
            a.genre6 LIKE CONCAT('%', ${genre}, '%')
          )
        `;

    const mappedArtists = artists.length > 0
      ? artists.map(mapArtist).sort((a, b) => a.name.localeCompare(b.name))
      : getArtistsByGenreFallback(genre);

    genreArtistsCache.set(cacheKey, { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, artists: mappedArtists });
    return mappedArtists;
  } catch {
    const fallback = getArtistsByGenreFallback(genre);
    genreArtistsCache.set(cacheKey, { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, artists: fallback });
    return fallback;
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
  const cacheKey = genre.trim().toLowerCase();
  const requestedOffset = Math.max(0, Number.isFinite(options?.offset) ? Number(options?.offset) : 0);
  const requestedLimit = Math.max(1, Math.min(120, Number.isFinite(options?.limit) ? Number(options?.limit) : 24));
  const minRequiredRows = requestedOffset + requestedLimit;
  const useDefaultCacheWindow = !options?.artists && requestedOffset === 0 && requestedLimit === 24;
  const fetchQueryLimit = Math.max(requestedLimit + requestedOffset + 24, requestedLimit + 24);
  const now = Date.now();

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
    if (!hasDatabaseUrl()) return seedVideos.slice(requestedOffset, requestedOffset + requestedLimit);
    return [];
  };

  const getGenreKeywordVideos = async () => {
    return prisma.$queryRaw<RankedVideoRow[]>`
      SELECT
        v.videoId, v.title, NULL AS channelTitle, v.favourited, v.description
      FROM videos v
      WHERE MATCH(v.title, v.parsedArtist, v.parsedTrack) AGAINST (${genre} IN NATURAL LANGUAGE MODE)
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

  if (!hasDatabaseUrl()) return seedVideos;

  try {
    return await withSoftTimeout(`getVideosByGenre:${cacheKey}`, CATEGORY_QUERY_TIMEOUT_MS, async () => {
      const keywordVideos = await getGenreKeywordVideos();
      considerRows(keywordVideos);

      const artistColumns = await getArtistColumnMap();
      const videoArtistNormColumn = await getVideoArtistNormalizationColumn();
      const videoArtistNormExpr = getVideoArtistNormalizationExpr("v", videoArtistNormColumn);
      const videoArtistIndexHint = await getVideoArtistNormalizationIndexHintClause(videoArtistNormColumn);

      if (artistColumns.genreColumns.length > 0) {
        const artistNameColumn = escapeSqlIdentifier(artistColumns.name);
        const genrePredicates = artistColumns.genreColumns
          .map((column) => `a.${escapeSqlIdentifier(column)} LIKE CONCAT('%', ?, '%')`)
          .join(" OR ");
        const genreParams = artistColumns.genreColumns.map(() => genre);

        const artistGenreRows = await prisma.$queryRawUnsafe<Array<{ artistName: string | null }>>(
          `SELECT a.${artistNameColumn} AS artistName FROM artists a WHERE (${genrePredicates}) LIMIT 64`,
          ...genreParams,
        );

        const normalizedGenreArtistNames = [...new Set(
          artistGenreRows
            .map((row) => normalizeArtistKey(row.artistName ?? ""))
            .filter((name) => name.length > 0),
        )];

        if (normalizedGenreArtistNames.length > 0) {
          const placeholders = normalizedGenreArtistNames.map(() => "?").join(", ");
          const artistGenreMatchedVideos = await prisma.$queryRawUnsafe<RankedVideoRow[]>(
            `
              SELECT v.videoId, v.title, NULL AS channelTitle, v.favourited, v.description
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
      const artistNames = [...new Set(artists.map((artist) => artist.name).filter(Boolean))].slice(0, 32);

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
        .map((name) => (name.includes(" ") ? `"${name}"` : name))
        .join(" ");

      const videos = await prisma.$queryRaw<RankedVideoRow[]>`
        SELECT v.videoId, v.title, NULL AS channelTitle, v.favourited, v.description
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
        .map((name) => normalizeArtistKey(name))
        .filter((name) => name.length > 0)
        .slice(0, 32);

      if (normalizedArtistNames.length > 0) {
        const placeholders = normalizedArtistNames.map(() => "?").join(", ");
        const artistMatchedVideos = await prisma.$queryRawUnsafe<RankedVideoRow[]>(
          `
            SELECT v.videoId, v.title, NULL AS channelTitle, v.favourited, v.description
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

      const normalizedGenreNeedle = `%${genre.trim().toLowerCase()}%`;
      const textMatchedVideos = await prisma.$queryRaw<RankedVideoRow[]>`
        SELECT v.videoId, v.title, NULL AS channelTitle, v.favourited, v.description
        FROM videos v
        WHERE v.videoId IS NOT NULL
          AND COALESCE(v.approved, 0) = 1
          AND (
            LOWER(v.title) LIKE ${normalizedGenreNeedle}
            OR LOWER(COALESCE(v.description, '')) LIKE ${normalizedGenreNeedle}
            OR LOWER(COALESCE(v.parsedArtist, '')) LIKE ${normalizedGenreNeedle}
            OR LOWER(COALESCE(v.parsedTrack, '')) LIKE ${normalizedGenreNeedle}
          )
          AND EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'available')
          AND NOT EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND (sv.status IS NULL OR sv.status <> 'available'))
        ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
        LIMIT ${fetchQueryLimit}
      `;
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
  } catch {
    const fallback = await getGenreFallback();
    storeGenreVideosInCache(fallback);
    return fallback;
  }
}
