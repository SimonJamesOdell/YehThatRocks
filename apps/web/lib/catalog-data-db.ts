/**
 * catalog-data-db.ts
 * Database schema introspection and low-level video-row queries.
 * All higher-level domain logic lives in the per-domain modules.
 */

import { prisma } from "@/lib/db";
import {
  debugCatalog,
  escapeSqlIdentifier,
  hasDatabaseUrl,
  normalizeYouTubeVideoId,
} from "@/lib/catalog-data-utils";
import type { StoredVideoRow } from "@/lib/catalog-data-utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TableColumnInfo = { Field: string; Type: string };
export type VideoForeignKeyRef = { tableName: string; columnName: string };

// StoredVideoRow is imported from catalog-data-utils (re-exported via barrel).
// Do not re-declare here to avoid duplicate-export errors.

// ── Constants ─────────────────────────────────────────────────────────────────

export const PARSED_ARTIST_NORM_INDEX = "idx_videos_parsed_artist_norm_fav_view_videoid_id";

export const AVAILABLE_SITE_VIDEOS_JOIN = `
        INNER JOIN (
          SELECT DISTINCT sv.video_id
          FROM site_videos sv
          WHERE sv.status = 'available'
        ) available_sv ON available_sv.video_id = v.id
`;

// ── Schema-introspection caches ───────────────────────────────────────────────

const tableColumnsCache = new Map<string, TableColumnInfo[]>();
const tableColumnsInFlight = new Map<string, Promise<TableColumnInfo[]>>();
let videoForeignKeyRefsCache: VideoForeignKeyRef[] | undefined;

let hasCheckedVideoMetadataColumns = false;
let videoMetadataColumnsAvailable = false;
let hasCheckedVideoChannelTitleColumn = false;
let videoChannelTitleColumnAvailable = false;

let parsedArtistNormIndexAvailableCache: boolean | undefined;

let artistStatsProjectionAvailabilityCache:
  | { checkedAt: number; available: boolean }
  | undefined;
let artistStatsThumbnailColumnAvailabilityCache:
  | { checkedAt: number; available: boolean }
  | undefined;

const ARTIST_STATS_TABLE_CACHE_TTL_MS = 60_000;

let artistColumnMapCache:
  | {
      name: string;
      normalizedName: string | null;
      country: string | null;
      genreColumns: string[];
    }
  | undefined;

let artistVideoColumnMapCache:
  | {
      artistName: string;
      normalizedArtistName: string | null;
      videoRef: string;
      joinsOnVideoPrimaryId: boolean;
    }
  | undefined;

let videoArtistNormalizationColumnCache: string | null | undefined;

// ── Schema introspection ──────────────────────────────────────────────────────

export async function loadTableColumns(tableName: string): Promise<TableColumnInfo[]> {
  const cached = tableColumnsCache.get(tableName);
  if (cached) {
    return cached;
  }

  const inFlight = tableColumnsInFlight.get(tableName);
  if (inFlight) {
    return inFlight;
  }

  const pending = (async () => {
    try {
      const columns = await prisma.$queryRawUnsafe<TableColumnInfo[]>(`SHOW COLUMNS FROM ${tableName}`);
      tableColumnsCache.set(tableName, columns);
      return columns;
    } catch {
      const empty: TableColumnInfo[] = [];
      tableColumnsCache.set(tableName, empty);
      return empty;
    }
  })();

  tableColumnsInFlight.set(tableName, pending);

  try {
    return await pending;
  } finally {
    if (tableColumnsInFlight.get(tableName) === pending) {
      tableColumnsInFlight.delete(tableName);
    }
  }
}

export function pickColumn(columns: TableColumnInfo[], names: string[]) {
  for (const name of names) {
    const match = columns.find((column) => column.Field === name);
    if (match) return match;
  }
  return undefined;
}

export async function loadVideoForeignKeyRefs(): Promise<VideoForeignKeyRef[]> {
  if (videoForeignKeyRefsCache) {
    return videoForeignKeyRefsCache;
  }

  try {
    const refs = await prisma.$queryRawUnsafe<Array<{ tableName: string; columnName: string }>>(
      `
        SELECT
          kcu.TABLE_NAME AS tableName,
          kcu.COLUMN_NAME AS columnName
        FROM information_schema.KEY_COLUMN_USAGE kcu
        WHERE kcu.TABLE_SCHEMA = DATABASE()
          AND kcu.REFERENCED_TABLE_SCHEMA = DATABASE()
          AND kcu.REFERENCED_TABLE_NAME = 'videos'
          AND kcu.REFERENCED_COLUMN_NAME = 'id'
      `,
    );

    videoForeignKeyRefsCache = refs.filter((row) => row.tableName && row.columnName);
    return videoForeignKeyRefsCache;
  } catch {
    videoForeignKeyRefsCache = [];
    return videoForeignKeyRefsCache;
  }
}

export async function ensureVideoMetadataColumnsAvailable() {
  if (hasCheckedVideoMetadataColumns || !hasDatabaseUrl()) {
    return videoMetadataColumnsAvailable;
  }

  hasCheckedVideoMetadataColumns = true;

  try {
    const columns = await prisma.$queryRaw<Array<{ Field: string }>>`SHOW COLUMNS FROM videos`;
    const names = new Set(columns.map((column) => column.Field));
    videoMetadataColumnsAvailable = names.has("parsedArtist") && names.has("parsedTrack");
  } catch {
    videoMetadataColumnsAvailable = false;
  }

  return videoMetadataColumnsAvailable;
}

export async function ensureVideoChannelTitleColumnAvailable() {
  if (hasCheckedVideoChannelTitleColumn || !hasDatabaseUrl()) {
    return videoChannelTitleColumnAvailable;
  }

  hasCheckedVideoChannelTitleColumn = true;

  try {
    const columns = await prisma.$queryRaw<Array<{ Field: string }>>`SHOW COLUMNS FROM videos LIKE 'channelTitle'`;
    videoChannelTitleColumnAvailable = columns.length > 0;
  } catch {
    videoChannelTitleColumnAvailable = false;
  }

  return videoChannelTitleColumnAvailable;
}

export async function hasArtistStatsProjection() {
  const now = Date.now();
  if (
    artistStatsProjectionAvailabilityCache &&
    artistStatsProjectionAvailabilityCache.checkedAt + ARTIST_STATS_TABLE_CACHE_TTL_MS > now
  ) {
    return artistStatsProjectionAvailabilityCache.available;
  }

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ Field: string }>>(
      "SHOW COLUMNS FROM artist_stats LIKE 'normalized_artist'",
    );

    const available = rows.length > 0;
    artistStatsProjectionAvailabilityCache = { checkedAt: now, available };
    return available;
  } catch {
    try {
      await prisma.$queryRawUnsafe("SELECT normalized_artist FROM artist_stats LIMIT 1");
      artistStatsProjectionAvailabilityCache = { checkedAt: now, available: true };
      return true;
    } catch {
      artistStatsProjectionAvailabilityCache = { checkedAt: now, available: false };
      return false;
    }
  }
}

export async function hasArtistStatsThumbnailColumn() {
  const now = Date.now();
  if (
    artistStatsThumbnailColumnAvailabilityCache &&
    artistStatsThumbnailColumnAvailabilityCache.checkedAt + ARTIST_STATS_TABLE_CACHE_TTL_MS > now
  ) {
    return artistStatsThumbnailColumnAvailabilityCache.available;
  }

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ Field: string }>>(
      "SHOW COLUMNS FROM artist_stats LIKE 'thumbnail_video_id'",
    );

    const available = rows.length > 0;
    artistStatsThumbnailColumnAvailabilityCache = { checkedAt: now, available };
    return available;
  } catch {
    try {
      await prisma.$queryRawUnsafe("SELECT thumbnail_video_id FROM artist_stats LIMIT 1");
      artistStatsThumbnailColumnAvailabilityCache = { checkedAt: now, available: true };
      return true;
    } catch {
      artistStatsThumbnailColumnAvailabilityCache = { checkedAt: now, available: false };
      return false;
    }
  }
}

export async function getArtistColumnMap() {
  if (artistColumnMapCache) {
    return artistColumnMapCache;
  }

  const columns = await prisma.$queryRawUnsafe<Array<{ Field: string }>>("SHOW COLUMNS FROM artists");
  const available = new Set(columns.map((column) => column.Field));

  const name = available.has("artist") ? "artist" : available.has("name") ? "name" : "artist";
  const normalizedName = ["artist_name_norm", "artist_norm", "normalized_artist", "name_normalized"].find((column) => available.has(column)) ?? null;
  const country = available.has("country") ? "country" : available.has("origin") ? "origin" : null;
  const genreColumns = ["genre1", "genre2", "genre3", "genre4", "genre5", "genre6"].filter((column) => available.has(column));

  artistColumnMapCache = { name, normalizedName, country, genreColumns };
  return artistColumnMapCache;
}

export async function getArtistVideoColumnMap() {
  if (artistVideoColumnMapCache) {
    return artistVideoColumnMapCache;
  }

  const columns = await prisma.$queryRawUnsafe<Array<{ Field: string; Type: string }>>("SHOW COLUMNS FROM videosbyartist");
  const available = new Set(columns.map((column) => column.Field));
  const typeByField = new Map(columns.map((column) => [column.Field, column.Type.toLowerCase()]));

  const artistName = available.has("artist")
    ? "artist"
    : available.has("artistname")
      ? "artistname"
      : available.has("artist_name")
        ? "artist_name"
        : "artist";
  const normalizedArtistName = ["artist_name_norm", "artist_norm", "normalized_artist"].find((column) => available.has(column)) ?? null;

  const videoRef = available.has("video_id")
    ? "video_id"
    : available.has("videoId")
      ? "videoId"
      : available.has("videoid")
        ? "videoid"
        : "videoId";

  const videoRefType = typeByField.get(videoRef) ?? "";
  const joinsOnVideoPrimaryId = videoRef === "video_id" || /(int|bigint|smallint|tinyint)/i.test(videoRefType);

  artistVideoColumnMapCache = { artistName, normalizedArtistName, videoRef, joinsOnVideoPrimaryId };
  return artistVideoColumnMapCache;
}

export async function getVideoArtistNormalizationColumn() {
  if (videoArtistNormalizationColumnCache !== undefined) {
    return videoArtistNormalizationColumnCache;
  }

  try {
    const columns = await prisma.$queryRawUnsafe<Array<{ Field: string }>>("SHOW COLUMNS FROM videos");
    const available = new Set(columns.map((column) => column.Field));
    videoArtistNormalizationColumnCache = [
      "parsed_artist_norm",
      "parsed_artist_normalized",
      "normalized_parsed_artist",
      "parsedArtistNormalized",
    ].find((column) => available.has(column)) ?? null;
  } catch {
    try {
      await prisma.$queryRawUnsafe("SELECT parsed_artist_norm FROM videos LIMIT 1");
      videoArtistNormalizationColumnCache = "parsed_artist_norm";
    } catch {
      videoArtistNormalizationColumnCache = null;
    }
  }

  return videoArtistNormalizationColumnCache;
}

export function getVideoArtistNormalizationExpr(alias: string, normalizedColumn: string | null, options?: { nullToEmpty?: boolean }) {
  const nullToEmpty = options?.nullToEmpty ?? true;

  if (normalizedColumn) {
    return `${alias}.${escapeSqlIdentifier(normalizedColumn)}`;
  }

  const parsedArtistRef = `${alias}.parsedArtist`;
  return nullToEmpty
    ? `LOWER(TRIM(COALESCE(${parsedArtistRef}, '')))`
    : `LOWER(TRIM(${parsedArtistRef}))`;
}

export async function getVideoArtistNormalizationIndexHintClause(normalizedColumn: string | null): Promise<string> {
  if (normalizedColumn !== "parsed_artist_norm") {
    return "";
  }

  if (parsedArtistNormIndexAvailableCache === undefined) {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ Key_name: string }>>("SHOW INDEX FROM videos");
      parsedArtistNormIndexAvailableCache = rows.some((row) => row.Key_name === PARSED_ARTIST_NORM_INDEX);
    } catch {
      parsedArtistNormIndexAvailableCache = false;
    }
  }

  return parsedArtistNormIndexAvailableCache ? ` FORCE INDEX (${PARSED_ARTIST_NORM_INDEX})` : "";
}

export function getArtistNameNormalizationExpr(alias: string, columns: { name: string; normalizedName: string | null }, options?: { nullToEmpty?: boolean }) {
  const nullToEmpty = options?.nullToEmpty ?? true;

  if (columns.normalizedName) {
    return `${alias}.${escapeSqlIdentifier(columns.normalizedName)}`;
  }

  const nameRef = `${alias}.${escapeSqlIdentifier(columns.name)}`;
  return nullToEmpty
    ? `LOWER(TRIM(COALESCE(${nameRef}, '')))`
    : `LOWER(TRIM(${nameRef}))`;
}

export function clearParsedArtistNormIndexCache() {
  parsedArtistNormIndexAvailableCache = undefined;
}

// ── Primitive video queries ───────────────────────────────────────────────────

export async function getFastVideoByVideoIdRows(
  normalizedVideoId: string,
  options?: { requireAvailable?: boolean; preferParsedArtist?: boolean; includeUnapproved?: boolean },
): Promise<StoredVideoRow[]> {
  const requireAvailable = options?.requireAvailable ?? false;
  const preferParsedArtist = options?.preferParsedArtist ?? false;
  const includeUnapproved = options?.includeUnapproved ?? false;
  const approvalFilter = includeUnapproved ? "" : "AND COALESCE(v.approved, 0) = 1";
  const availabilityFilter = requireAvailable
    ? `
      AND EXISTS (
        SELECT 1
        FROM site_videos sv
        WHERE sv.video_id = v.id
          AND sv.status = 'available'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM site_videos sv
        WHERE sv.video_id = v.id
          AND (sv.status IS NULL OR sv.status <> 'available')
      )
    `
    : "";
  const orderByClause = preferParsedArtist
    ? `
      ORDER BY
        CASE
          WHEN v.parsedArtist IS NULL OR TRIM(v.parsedArtist) = '' THEN 1
          ELSE 0
        END ASC,
        v.id DESC
    `
    : "ORDER BY v.updated_at DESC, v.id DESC";

  const fastSql = `
    SELECT
      v.id,
      v.videoId,
      v.title,
      NULL AS channelTitle,
      NULLIF(TRIM(v.parsedArtist), '') AS parsedArtist,
      COALESCE(v.favourited, 0) AS favourited,
      v.description
    FROM videos v FORCE INDEX (videos_videoId_key)
    WHERE v.videoId = ?
      ${approvalFilter}
      ${availabilityFilter}
    ${orderByClause}
    LIMIT 1
  `;

  const fallbackSql = `
    SELECT
      v.id,
      v.videoId,
      v.title,
      NULL AS channelTitle,
      NULLIF(TRIM(v.parsedArtist), '') AS parsedArtist,
      COALESCE(v.favourited, 0) AS favourited,
      v.description
    FROM videos v
    WHERE v.videoId = ?
      ${approvalFilter}
      ${availabilityFilter}
    ${orderByClause}
    LIMIT 1
  `;

  try {
    return await prisma.$queryRawUnsafe<StoredVideoRow[]>(fastSql, normalizedVideoId);
  } catch {
    return prisma.$queryRawUnsafe<StoredVideoRow[]>(fallbackSql, normalizedVideoId);
  }
}

export async function getStoredVideoById(videoId: string, options?: { includeUnapproved?: boolean }): Promise<StoredVideoRow | null> {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  if (!normalizedVideoId || !hasDatabaseUrl()) {
    return null;
  }

  const rows = await getFastVideoByVideoIdRows(normalizedVideoId, {
    requireAvailable: false,
    includeUnapproved: Boolean(options?.includeUnapproved),
  });

  debugCatalog("getStoredVideoById", {
    requestedVideoId: videoId,
    normalizedVideoId,
    found: rows.length > 0,
  });

  return rows[0] ?? null;
}
