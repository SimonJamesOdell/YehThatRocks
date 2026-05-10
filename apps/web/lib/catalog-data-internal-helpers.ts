import type { PlaylistDetail } from "@/lib/catalog-data-utils";
import { hasDatabaseUrl, normalizeYouTubeVideoId } from "@/lib/catalog-data-utils";

type PlaylistFallbackRow = {
  id: number | bigint;
  name: string | null;
};

export function buildApprovedVideoPredicate(alias?: string) {
  const approvedColumn = alias ? `${alias}.approved` : "approved";
  return `COALESCE(${approvedColumn}, 0) = 1`;
}

export function getDatabaseNormalizedVideoId(videoId?: string | null) {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);
  if (!normalizedVideoId || !hasDatabaseUrl()) {
    return null;
  }
  return normalizedVideoId;
}

export function hasDatabaseUserScope(userId?: number) {
  return hasDatabaseUrl() && Boolean(userId);
}

export function getTrimmedDatabaseValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !hasDatabaseUrl()) {
    return null;
  }
  return trimmed;
}

export function getLowerTrimmedDatabaseValue(value: string) {
  const trimmed = getTrimmedDatabaseValue(value);
  return trimmed ? trimmed.toLowerCase() : null;
}

export function mapPlaylistFallbackRowToDetail(row: PlaylistFallbackRow): PlaylistDetail {
  return {
    id: String(typeof row.id === "bigint" ? Number(row.id) : row.id),
    name: row.name ?? "Untitled Playlist",
    videos: [],
  };
}
