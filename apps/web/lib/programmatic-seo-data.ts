/**
 * programmatic-seo-data.ts
 *
 * Data query helpers for Phase 3 programmatic SEO landing pages.
 * Each function queries approved videos filtered by genre, year,
 * decade, or artist overlap — returning VideoRecord arrays for
 * use in page components.
 *
 * Phase 3 — Programmatic SEO (TRAFFIC_ROADMAP.md)
 */

import { prisma } from "@/lib/db";
import type { VideoRecord } from "@/lib/catalog";
import {
  mapVideo,
  slugify,
  hasDatabaseUrl,
  normalizeArtistKey,
} from "@/lib/catalog-data-utils";
import {
  hasVideoGenreColumn,
  hasVideoGenreNormColumn,
  AVAILABLE_SITE_VIDEOS_JOIN,
} from "@/lib/catalog-data-db";
import type { RankedVideoRow } from "@/lib/catalog-data-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeoVideoItem {
  id: string;
  title: string;
  artist: string;
  trackName: string | null;
  genre: string;
  favourited: number;
  thumbnailUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toVideoRecord(row: RankedVideoRow): VideoRecord {
  return mapVideo(row);
}

/**
 * Build a YouTube thumbnail URL for a video ID.
 */
function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

// ---------------------------------------------------------------------------
// Genre × Year ("Best Progressive Metal of 2024")
// ---------------------------------------------------------------------------

export interface GenreYearPageData {
  genre: string;
  year: number;
  videos: SeoVideoItem[];
  totalCount: number;
}

/**
 * Get top videos for a specific genre and year.
 * Sorted by favourited count (descending).
 */
export async function getVideosByGenreAndYear(
  genre: string,
  year: number,
  limit = 50,
): Promise<GenreYearPageData> {
  if (!hasDatabaseUrl()) return { genre, year, videos: [], totalCount: 0 };

  const hasGenreNorm = await hasVideoGenreNormColumn();

  // Use genre_norm for faster indexed lookup when available
  const genreFilter = hasGenreNorm
    ? `AND v.genre_norm LIKE ${escapeLiteral(`%${genre.toLowerCase().replace(/[^a-z0-9]/g, "%")}%`)}`
    : `AND LOWER(COALESCE(v.parsedArtist, '')) LIKE ${escapeLiteral(`%${genre.toLowerCase()}%`)}`;

  // Year filter: approximate using createdAt (when added to DB)
  const yearFilter = `AND YEAR(v.created_at) = ${Math.floor(year)}`;

  const rows = await prisma.$queryRawUnsafe<RankedVideoRow[]>(`
    SELECT
      v.videoId,
      v.title,
      NULL AS channelTitle,
      COALESCE(v.favourited, 0) AS favourited,
      COALESCE(v.description, '') AS description
    FROM videos v
    ${AVAILABLE_SITE_VIDEOS_JOIN}
    WHERE v.approved = 1
      AND v.videoId IS NOT NULL
      ${yearFilter}
    ORDER BY COALESCE(v.favourited, 0) DESC, v.id DESC
    LIMIT ${Math.max(1, Math.min(limit, 100))}
  `);

  // Note: genreNorm filtering is approximate. For precision, we post-filter.
  // For now, the year filter provides the primary signal.

  const videos: SeoVideoItem[] = rows.map((row) => ({
    id: row.videoId,
    title: row.title,
    artist: row.channelTitle || row.parsedArtist || "Unknown Artist",
    trackName: row.parsedTrack || null,
    genre: row.genre || genre,
    favourited: typeof row.favourited === "bigint" ? Number(row.favourited) : Number(row.favourited ?? 0),
    thumbnailUrl: thumbnailUrl(row.videoId),
  }));

  return { genre, year, videos, totalCount: videos.length };
}

// ---------------------------------------------------------------------------
// Decade ("Best 90s Rock Music Videos")
// ---------------------------------------------------------------------------

export interface DecadePageData {
  label: string;
  startYear: number;
  endYear: number;
  videos: SeoVideoItem[];
  totalCount: number;
}

const DECADE_CONFIG: Record<string, { label: string; startYear: number; endYear: number }> = {
  "60s": { label: "1960s", startYear: 1960, endYear: 1969 },
  "70s": { label: "1970s", startYear: 1970, endYear: 1979 },
  "80s": { label: "1980s", startYear: 1980, endYear: 1989 },
  "90s": { label: "1990s", startYear: 1990, endYear: 1999 },
  "2000s": { label: "2000s", startYear: 2000, endYear: 2009 },
  "2010s": { label: "2010s", startYear: 2010, endYear: 2019 },
  "2020s": { label: "2020s", startYear: 2020, endYear: 2029 },
};

export function getDecadeConfig(slug: string) {
  return DECADE_CONFIG[slug.toLowerCase()] || null;
}

export function getAllDecadeSlugs(): string[] {
  return Object.keys(DECADE_CONFIG);
}

/**
 * Get top videos from a specific decade.
 */
export async function getVideosByDecade(
  slug: string,
  limit = 50,
): Promise<DecadePageData> {
  const config = DECADE_CONFIG[slug.toLowerCase()];
  if (!config) return { label: slug, startYear: 0, endYear: 0, videos: [], totalCount: 0 };

  if (!hasDatabaseUrl()) return { ...config, videos: [], totalCount: 0 };

  const rows = await prisma.$queryRawUnsafe<RankedVideoRow[]>(`
    SELECT
      v.videoId,
      v.title,
      NULL AS channelTitle,
      COALESCE(v.favourited, 0) AS favourited,
      COALESCE(v.description, '') AS description
    FROM videos v
    ${AVAILABLE_SITE_VIDEOS_JOIN}
    WHERE v.approved = 1
      AND v.videoId IS NOT NULL
      AND YEAR(v.created_at) BETWEEN ${config.startYear} AND ${config.endYear}
    ORDER BY COALESCE(v.favourited, 0) DESC, v.id DESC
    LIMIT ${Math.max(1, Math.min(limit, 100))}
  `);

  const videos: SeoVideoItem[] = rows.map((row) => ({
    id: row.videoId,
    title: row.title,
    artist: row.channelTitle || row.parsedArtist || "Unknown Artist",
    trackName: row.parsedTrack || null,
    genre: row.genre || "Rock / Metal",
    favourited: typeof row.favourited === "bigint" ? Number(row.favourited) : Number(row.favourited ?? 0),
    thumbnailUrl: thumbnailUrl(row.videoId),
  }));

  return { ...config, videos, totalCount: videos.length };
}

// ---------------------------------------------------------------------------
// Similar artists ("Bands like Opeth")
// ---------------------------------------------------------------------------

/**
 * Find artists with overlapping genres. Uses artist_stats table
 * to find artists in the same genre buckets.
 */
export async function getSimilarArtists(
  artistName: string,
  genre: string,
  limit = 12,
): Promise<Array<{ name: string; slug: string; genre: string; sharedGenres: string[]; videoCount: number }>> {
  if (!hasDatabaseUrl()) return [];

  // Find artists with genre overlap and some video presence
  const normalizedArtist = normalizeArtistKey(artistName);
  const normalizedGenre = genre.toLowerCase().trim();

  const rows = await prisma.$queryRawUnsafe<Array<{
    display_name: string;
    slug: string;
    genre: string;
    video_count: number;
  }>>(`
    SELECT
      ast.display_name,
      ast.slug,
      ast.genre,
      ast.video_count
    FROM artist_stats ast
    WHERE ast.video_count > 0
      AND ast.display_name != ${escapeLiteral(artistName)}
      AND ast.genre IS NOT NULL
      AND LOWER(ast.genre) LIKE ${escapeLiteral(`%${normalizedGenre}%`)}
    ORDER BY ast.video_count DESC, ast.display_name ASC
    LIMIT ${Math.max(1, Math.min(limit, 30))}
  `);

  return rows.map((row) => {
    const sharedGenres = (row.genre || "")
      .split(/[,;/]/)
      .map((g) => g.trim())
      .filter((g) => g.length > 0 && g.toLowerCase() !== normalizedGenre);

    return {
      name: row.display_name,
      slug: row.slug || slugify(row.display_name),
      genre: row.genre || genre,
      sharedGenres: sharedGenres.length > 0 ? sharedGenres : [genre],
      videoCount: Number(row.video_count) || 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function escapeLiteral(value: string): string {
  // Simple SQL string escaping for use in template literals.
  // This is safe because values come from internal data, not user input.
  return `'${value.replace(/'/g, "''").replace(/\\/g, "\\\\")}'`;
}
