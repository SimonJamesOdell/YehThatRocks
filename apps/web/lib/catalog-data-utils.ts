/**
 * catalog-data-utils.ts
 * Pure, side-effect-free utilities and shared type definitions used across
 * all catalog-data domain modules. No prisma import, no DB calls.
 */

import type { ArtistRecord, VideoRecord } from "@/lib/catalog";
import {
  buildNormalizedVideoTitleFromMetadata,
  inferArtistFromTitle,
  normalizeParsedConfidence,
  normalizeParsedString,
  normalizePossiblyMojibakeText,
} from "@/lib/catalog-metadata-utils";

export { buildNormalizedVideoTitleFromMetadata };

// ── Public exported types ──────────────────────────────────────────────────────

export type DataSourceStatus = {
  mode: "database" | "database-error";
  envConfigured: boolean;
  videoCount: number;
  artistCount: number;
  genreCount: number;
  detail: string;
};

export type PlaylistSummary = {
  id: string;
  name: string;
  itemCount: number;
  leadVideoId: string;
};

export type PlaylistVideoRecord = VideoRecord & {
  playlistItemId?: string;
};

export type PlaylistDetail = {
  id: string;
  name: string;
  videos: PlaylistVideoRecord[];
};

export type WatchHistoryEntry = {
  video: VideoRecord;
  lastWatchedAt: string;
  watchCount: number;
  maxProgressPercent: number;
};

export type HiddenVideoEntry = {
  video: VideoRecord;
  hiddenAt: string;
};

export type GenreCard = {
  genre: string;
  previewVideoId: string | null;
};

export type PlaybackDecision = {
  allowed: boolean;
  reason:
    | "ok"
    | "invalid-video-id"
    | "not-found"
    | "missing-metadata"
    | "low-confidence"
    | "unknown-video-type"
    | "unavailable";
  message?: string;
};

export type PublicUserProfile = {
  id: number;
  screenName: string;
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
  joinedAt?: string;
};

export type SearchSuggestion = {
  type: "artist" | "track" | "genre";
  label: string;
  url: string;
};

// ── Internal shared types (exported for use within catalog-data modules) ──────

export type RankedVideoRow = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  parsedArtist?: string | null;
  parsedTrack?: string | null;
  favourited: number;
  description: string | null;
};

export type StoredVideoRow = RankedVideoRow & {
  id: number;
};

export type PersistableVideoRecord = VideoRecord & {
  thumbnail?: string;
};

export type PlaybackDecisionRow = {
  id: number;
  title: string;
  description: string | null;
  parsedArtist: string | null;
  parsedTrack: string | null;
  parsedVideoType: string | null;
  parseConfidence: number | null;
  hasAvailable: number;
  hasBlocked: number;
  hasCheckFailed?: number;
};

export type ParsedVideoMetadata = {
  artist: string | null;
  track: string | null;
  videoType: string | null;
  confidence: number | null;
  reason: string | null;
};

// ── Constants ─────────────────────────────────────────────────────────────────

export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export const ROCK_METAL_GENRE_PATTERN = /\b(rock|metal|hard rock|heavy metal|thrash|death metal|black metal|doom metal|metalcore|deathcore|nu metal|alternative rock|alt rock|progressive rock|progressive metal|punk rock|post[- ]?hardcore|grunge)\b/i;

export const CATALOG_DEBUG_ENABLED =
  process.env.NODE_ENV === "development" && process.env.DEBUG_CATALOG === "1";

export const ENABLE_SAME_GENRE_RELATED = process.env.RELATED_ENABLE_SAME_GENRE === "1";

// ── Utility functions ─────────────────────────────────────────────────────────

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

export function requireDatabaseUrl(context: string) {
  if (!hasDatabaseUrl()) {
    throw new Error(`${context} requires a configured DATABASE_URL.`);
  }
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeArtistKey(value: string) {
  return value.trim().toLowerCase();
}

export function getGenreSlug(value: string) {
  return slugify(value);
}

export function debugCatalog(event: string, detail?: Record<string, unknown>) {
  if (!CATALOG_DEBUG_ENABLED) {
    return;
  }
  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[catalog-data] ${event}${payload}`);
}

export function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

export async function withSoftTimeout<T>(label: string, timeoutMs: number, operation: () => Promise<T>) {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

export function extractJsonObject(content: unknown) {
  if (typeof content !== "string") {
    throw new Error("Groq returned non-string message content");
  }
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error(`Unable to parse Groq JSON payload: ${trimmed.slice(0, 220)}`);
  }
}

export function escapeSqlIdentifier(identifier: string) {
  return `\`${identifier.replace(/`/g, "``")}\``;
}

export function getYouTubeThumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function dedupeRankedRows(rows: RankedVideoRow[]) {
  const byId = new Map<string, RankedVideoRow>();
  for (const row of rows) {
    if (!byId.has(row.videoId)) {
      byId.set(row.videoId, row);
    }
  }
  return [...byId.values()];
}

export function selectUniqueVideoRows(rows: RankedVideoRow[], blockedIds: Set<string>, limit: number) {
  const selected: RankedVideoRow[] = [];
  for (const row of rows) {
    if (blockedIds.has(row.videoId)) {
      continue;
    }
    blockedIds.add(row.videoId);
    selected.push(row);
    if (selected.length >= limit) {
      break;
    }
  }
  return selected;
}

export function rotateRowsBySeed(rows: RankedVideoRow[], seedInput: string) {
  if (rows.length <= 1) {
    return rows;
  }
  let hash = 0;
  for (let index = 0; index < seedInput.length; index += 1) {
    hash = (hash * 31 + seedInput.charCodeAt(index)) >>> 0;
  }
  const offset = hash % rows.length;
  return [...rows.slice(offset), ...rows.slice(0, offset)];
}

export function intersectVideoIdsWithCandidates(videoIds: Iterable<string>, candidateIds: Set<string>) {
  const matched = new Set<string>();
  for (const videoId of videoIds) {
    if (candidateIds.has(videoId)) {
      matched.add(videoId);
    }
  }
  return matched;
}

export function normalizeYouTubeVideoId(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (YOUTUBE_VIDEO_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }
  const candidates: string[] = [];
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be" || host.endsWith(".youtu.be")) {
      const shortId = parsed.pathname.split("/").filter(Boolean)[0];
      if (shortId) {
        candidates.push(shortId);
      }
    }
    const searchId = parsed.searchParams.get("v");
    if (searchId) {
      candidates.push(searchId);
    }
    const segments = parsed.pathname.split("/").filter(Boolean);
    const embedLikeIndex = segments.findIndex((segment) =>
      ["embed", "shorts", "live", "v"].includes(segment),
    );
    if (embedLikeIndex >= 0 && segments[embedLikeIndex + 1]) {
      candidates.push(segments[embedLikeIndex + 1]);
    }
  } catch {
    const watchMatch = trimmed.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (watchMatch?.[1]) {
      candidates.push(watchMatch[1]);
    }
    const shortMatch = trimmed.match(/youtu\.be\/([A-Za-z0-9_-]{11})/i);
    if (shortMatch?.[1]) {
      candidates.push(shortMatch[1]);
    }
  }
  return candidates.find((candidate) => YOUTUBE_VIDEO_ID_PATTERN.test(candidate));
}

export function resolveSelectedVideoId(
  searchParams?: Record<string, string | string[] | undefined>,
  fallbackVideoId?: string,
) {
  const rawSelectedVideo =
    typeof searchParams?.v === "string"
      ? searchParams.v
      : Array.isArray(searchParams?.v)
        ? searchParams.v[0]
        : undefined;
  const selectedVideoId = normalizeYouTubeVideoId(rawSelectedVideo) ?? rawSelectedVideo;
  return selectedVideoId ?? fallbackVideoId;
}

export function mapVideo(video: {
  videoId: string;
  title: string;
  channelTitle: string | null;
  parsedArtist?: string | null;
  parsedTrack?: string | null;
  favourited: number | bigint | null;
  description: string | null;
}): VideoRecord {
  const favouritedValue =
    typeof video.favourited === "bigint"
      ? Number(video.favourited)
      : Number(video.favourited ?? 0);

  const inferredChannelTitle = inferArtistFromTitle(video.title);
  const parsedArtist = video.parsedArtist?.trim() || "";
  const channelTitle = video.channelTitle?.trim() || "";

  const displayArtist =
    parsedArtist ||
    channelTitle ||
    inferredChannelTitle ||
    "Unknown Artist";

  return {
    id: video.videoId,
    title: video.title,
    channelTitle: displayArtist,
    genre: "Rock / Metal",
    favourited: Number.isFinite(favouritedValue) ? favouritedValue : 0,
    description: video.description ?? "Legacy video entry from the retained Yeh database.",
  };
}

export function mapVideoRecordToRankedRow(video: VideoRecord): RankedVideoRow {
  return {
    videoId: video.id,
    title: video.title,
    channelTitle: video.channelTitle || null,
    parsedArtist: video.channelTitle || null,
    favourited: video.favourited,
    description: video.description,
  };
}

export function mapStoredVideoToPersistable(video: StoredVideoRow): PersistableVideoRecord {
  return {
    ...mapVideo(video),
  };
}

export type PlaylistVideoRowInput = RankedVideoRow & { playlistItemId: number | bigint | string };

export function mapPlaylistVideo(video: {
  playlistItemId: number | bigint | string;
  videoId: string;
  title: string;
  channelTitle: string | null;
  parsedArtist?: string | null;
  favourited: number | bigint | null;
  description: string | null;
}): PlaylistVideoRecord {
  return {
    ...mapVideo(video),
    playlistItemId:
      typeof video.playlistItemId === "bigint"
        ? video.playlistItemId.toString()
        : String(video.playlistItemId),
  };
}

export function mapArtist(artist: {
  name: string;
  country: string | null;
  genre1: string | null;
}): ArtistRecord {
  return {
    name: artist.name,
    slug: slugify(artist.name),
    country: artist.country ?? "Unknown",
    genre: artist.genre1 ?? "Rock / Metal",
    thumbnailVideoId: undefined,
  };
}

export function mapArtistProjectionRow(row: {
  displayName: string;
  slug: string;
  country: string | null;
  genre: string | null;
  thumbnailVideoId?: string | null;
}): ArtistRecord {
  const normalizedThumbnailVideoId = normalizeYouTubeVideoId(row.thumbnailVideoId);
  return {
    name: row.displayName,
    slug: row.slug,
    country: row.country ?? "Unknown",
    genre: row.genre ?? "Rock / Metal",
    thumbnailVideoId: normalizedThumbnailVideoId,
  };
}

export { normalizeParsedString, normalizeParsedConfidence, normalizePossiblyMojibakeText };
