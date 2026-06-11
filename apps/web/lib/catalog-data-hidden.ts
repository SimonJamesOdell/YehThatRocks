/**
 * catalog-data-hidden.ts
 * Hidden videos domain: per-user hidden/blocked video tracking.
 */

import { prisma } from "@/lib/db";
import { BoundedMap } from "@/lib/bounded-map";
import type { HiddenVideoEntry } from "@/lib/catalog-data-utils";
import {
  hasDatabaseUrl,
  mapVideo,
  normalizeYouTubeVideoId,
} from "@/lib/catalog-data-utils";
import { ensureVideoChannelTitleColumnAvailable } from "@/lib/catalog-data-db";
import { clearFavouritesCacheForUser } from "@/lib/catalog-data-favourites";

// ── Constants & caches ────────────────────────────────────────────────────────

const USER_SCOPED_CACHE_MAX_ENTRIES = Math.max(
  100,
  Math.min(10_000, Number(process.env.USER_SCOPED_CACHE_MAX_ENTRIES || "1000")),
);

const HIDDEN_VIDEO_IDS_CACHE_TTL_MS = 20_000;
const hiddenVideoIdsCache = new BoundedMap<number, { expiresAt: number; ids: Set<string> }>(
  USER_SCOPED_CACHE_MAX_ENTRIES,
);
const hiddenVideoIdsInFlight = new BoundedMap<number, Promise<Set<string>>>(
  USER_SCOPED_CACHE_MAX_ENTRIES,
);

// ── Private helpers ───────────────────────────────────────────────────────────

function cloneHiddenIdSet(ids: Set<string>) {
  return new Set(ids);
}

function cacheHiddenVideoIdsForUser(userId: number, ids: Set<string>) {
  hiddenVideoIdsCache.delete(userId);
  hiddenVideoIdsCache.set(userId, {
    expiresAt: Date.now() + HIDDEN_VIDEO_IDS_CACHE_TTL_MS,
    ids: cloneHiddenIdSet(ids),
  });
}

function getCachedHiddenVideoIdsForUser(userId: number): Set<string> | undefined {
  const cached = hiddenVideoIdsCache.get(userId);
  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    hiddenVideoIdsCache.delete(userId);
    return undefined;
  }

  return cloneHiddenIdSet(cached.ids);
}

function updateCachedHiddenVideoIdsForUser(
  userId: number,
  videoId: string,
  hidden: boolean,
) {
  const cached = hiddenVideoIdsCache.get(userId);
  if (!cached || cached.expiresAt <= Date.now()) {
    hiddenVideoIdsCache.delete(userId);
    return;
  }

  const next = cloneHiddenIdSet(cached.ids);
  if (hidden) {
    next.add(videoId);
  } else {
    next.delete(videoId);
  }

  cacheHiddenVideoIdsForUser(userId, next);
}

async function loadHiddenVideoIdsForUser(userId: number): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<Array<{ videoId: string | null }>>`
    SELECT video_id AS videoId
    FROM hidden_videos
    WHERE user_id = ${userId}
  `;

  const ids = new Set<string>(
    rows.map((row: { videoId: string | null }) => row.videoId).filter((videoId: string | null): videoId is string => Boolean(videoId)),
  );
  cacheHiddenVideoIdsForUser(userId, ids);
  return ids;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getHiddenVideoIdsForUser(userId: number): Promise<Set<string>> {
  if (!hasDatabaseUrl() || !Number.isInteger(userId) || userId <= 0) {
    return new Set<string>();
  }

  const cached = getCachedHiddenVideoIdsForUser(userId);
  if (cached) {
    return cached;
  }

  const inFlight = hiddenVideoIdsInFlight.get(userId);
  if (inFlight) {
    return cloneHiddenIdSet(await inFlight);
  }

  const pending = loadHiddenVideoIdsForUser(userId);
  hiddenVideoIdsInFlight.set(userId, pending);

  try {
    return cloneHiddenIdSet(await pending);
  } catch {
    return new Set<string>();
  } finally {
    if (hiddenVideoIdsInFlight.get(userId) === pending) {
      hiddenVideoIdsInFlight.delete(userId);
    }
  }
}

export async function getHiddenVideoMatchesForUser(
  userId: number,
  candidateVideoIds: string[],
): Promise<Set<string>> {
  if (!hasDatabaseUrl() || !Number.isInteger(userId) || userId <= 0) {
    return new Set<string>();
  }

  const normalizedCandidates = [
    ...new Set(
      candidateVideoIds.filter((id: string) => typeof id === "string" && id.length > 0),
    ),
  ];
  if (normalizedCandidates.length === 0) {
    return new Set<string>();
  }

  try {
    const hiddenIds = await getHiddenVideoIdsForUser(userId);
    const hidden = new Set<string>();

    for (const candidateVideoId of normalizedCandidates) {
      if (hiddenIds.has(candidateVideoId)) {
        hidden.add(candidateVideoId);
      }
    }

    return hidden;
  } catch {
    return new Set<string>();
  }
}

export async function getHiddenVideosForUser(
  userId: number,
  options?: { limit?: number; offset?: number },
): Promise<HiddenVideoEntry[]> {
  if (!hasDatabaseUrl() || !Number.isInteger(userId) || userId <= 0) {
    return [];
  }

  const limit = Math.max(1, Math.min(200, Math.floor(options?.limit ?? 50)));
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));
  const hasChannelTitleColumn = await ensureVideoChannelTitleColumnAvailable();
  const channelTitleExpr = hasChannelTitleColumn ? "NULLIF(TRIM(v.channelTitle), '')" : "NULL";

  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        videoId: string | null;
        title: string | null;
        parsedArtist: string | null;
        channelTitle: string | null;
        favourited: number | bigint | null;
        description: string | null;
        hiddenAt: Date | string | null;
      }>
    >(
      `
        SELECT
          hv.video_id AS videoId,
          COALESCE(v.title, CONCAT('Video ', hv.video_id)) AS title,
          NULLIF(TRIM(v.parsedArtist), '') AS parsedArtist,
          ${channelTitleExpr} AS channelTitle,
          COALESCE(v.favourited, 0) AS favourited,
          COALESCE(v.description, 'Blocked track') AS description,
          hv.created_at AS hiddenAt
        FROM hidden_videos hv
        LEFT JOIN videos v ON v.videoId = hv.video_id
        WHERE hv.user_id = ?
        ORDER BY hv.created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `,
      userId,
    );

    return rows
      .filter((row: { videoId: string | null }) => typeof row.videoId === "string" && row.videoId.length > 0)
      .map((row: { videoId: string | null; title: string | null; parsedArtist: string | null; channelTitle: string | null; favourited: number | bigint | null; description: string | null; hiddenAt: Date | string | null }) => ({
        video: mapVideo({
          videoId: row.videoId as string,
          title: row.title ?? "Unknown title",
          channelTitle: row.channelTitle,
          parsedArtist: row.parsedArtist,
          favourited: row.favourited ?? 0,
          description: row.description,
        }),
        hiddenAt: row.hiddenAt
          ? new Date(row.hiddenAt).toISOString()
          : new Date(0).toISOString(),
      }));
  } catch {
    return [];
  }
}

export async function hideVideoForUser(input: { userId: number; videoId: string }) {
  const normalizedVideoId = normalizeYouTubeVideoId(input.videoId);
  if (
    !hasDatabaseUrl() ||
    !normalizedVideoId ||
    !Number.isInteger(input.userId) ||
    input.userId <= 0
  ) {
    return { ok: false as const };
  }

  try {
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO hidden_videos (user_id, video_id)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE video_id = VALUES(video_id)
      `,
      input.userId,
      normalizedVideoId,
    );

    const removed = await prisma.favourite.deleteMany({
      where: {
        userid: input.userId,
        videoId: normalizedVideoId,
      },
    });

    const removedFavourite = removed.count > 0;

    updateCachedHiddenVideoIdsForUser(input.userId, normalizedVideoId, true);

    if (removedFavourite) {
      clearFavouritesCacheForUser(input.userId);
      const { invalidateTopVideosCache } = await import("@/lib/top-videos-cache");
      invalidateTopVideosCache();
    }

    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
}

// ── Batch playlist pruning helpers ─────────────────────────────────────────────
// Instead of the N+1 per-playlist loop in hideVideoAndPrunePlaylistsForUser,
// these helpers batch-find and batch-delete playlist items referencing a hidden
// video, then batch-delete any playlists left empty.

type PlaylistItemRef = {
  playlistId: number;
  itemRowId: number;
};

async function findPlaylistItemsByVideoIdBatch(
  userId: number,
  normalizedVideoId: string,
): Promise<PlaylistItemRef[]> {
  // Try camelCase schema variant first, then snake_case.
  const queries = [
    // camelCase: playlistitems.playlistId / playlistitems.videoId / playlistnames.userId
    `SELECT p.id AS playlistId, pi.id AS itemRowId
     FROM playlistitems pi
     JOIN playlistnames p ON p.id = pi.playlistId
     WHERE p.userId = ? AND pi.videoId = ?`,
    // snake_case: playlistitems.playlist_id / playlistitems.video_id / playlistnames.user_id
    `SELECT p.id AS playlistId, pi.id AS itemRowId
     FROM playlistitems pi
     JOIN playlistnames p ON p.id = pi.playlist_id
     WHERE p.user_id = ? AND pi.video_id = ?`,
  ];

  for (const sql of queries) {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ playlistId: number | bigint; itemRowId: number | bigint }>>(
        sql, userId, normalizedVideoId,
      );
      if (rows.length > 0) {
        return rows.map((r) => ({
          playlistId: typeof r.playlistId === "bigint" ? Number(r.playlistId) : r.playlistId,
          itemRowId: typeof r.itemRowId === "bigint" ? Number(r.itemRowId) : r.itemRowId,
        }));
      }
    } catch {
      // Try next schema variant.
    }
  }

  return [];
}

async function batchRemovePlaylistItems(
  items: PlaylistItemRef[],
): Promise<{ removedCount: number; affectedPlaylistIds: Set<string> }> {
  if (items.length === 0) return { removedCount: 0, affectedPlaylistIds: new Set() };

  const affectedPlaylistIds = new Set<string>();
  let removedCount = 0;

  // Batch delete all items in one query using IN (...)
  const itemIds = items.map((i) => i.itemRowId);
  const placeholders = itemIds.map(() => "?").join(", ");

  try {
    const result = await prisma.$executeRawUnsafe(
      `DELETE FROM playlistitems WHERE id IN (${placeholders})`,
      ...itemIds,
    );
    removedCount = Number(result);
    for (const item of items) {
      affectedPlaylistIds.add(String(item.playlistId));
    }
  } catch {
    // Fallback: delete one by one
    for (const item of items) {
      try {
        await prisma.$executeRawUnsafe(
          `DELETE FROM playlistitems WHERE id = ?`,
          item.itemRowId,
        );
        removedCount++;
        affectedPlaylistIds.add(String(item.playlistId));
      } catch {
        // Continue with remaining items.
      }
    }
  }

  return { removedCount, affectedPlaylistIds };
}

async function batchDeleteEmptyPlaylists(
  playlistIds: string[],
  userId: number,
): Promise<Set<string>> {
  const deleted = new Set<string>();
  if (playlistIds.length === 0) return deleted;

  // Check which playlists are empty and delete them in one pass
  for (const id of playlistIds) {
    try {
      // Only delete if the playlist has zero items
      const numericId = Number(id);
      // Try camelCase first
      let deleted_ = false;
      try {
        const result = await prisma.$executeRawUnsafe(
          `DELETE FROM playlistnames WHERE id = ? AND userId = ?
           AND NOT EXISTS (SELECT 1 FROM playlistitems WHERE playlistId = ?)`,
          numericId, userId, numericId,
        );
        deleted_ = Number(result) > 0;
      } catch {
        try {
          const result = await prisma.$executeRawUnsafe(
            `DELETE FROM playlistnames WHERE id = ? AND user_id = ?
             AND NOT EXISTS (SELECT 1 FROM playlistitems WHERE playlist_id = ?)`,
            numericId, userId, numericId,
          );
          deleted_ = Number(result) > 0;
        } catch {
          // Skip this playlist.
        }
      }
      if (deleted_) deleted.add(id);
    } catch {
      // Continue.
    }
  }

  return deleted;
}

export async function hideVideoAndPrunePlaylistsForUser(input: {
  userId: number;
  videoId: string;
  activePlaylistId?: string | null;
}) {
  const normalizedVideoId = normalizeYouTubeVideoId(input.videoId);
  if (
    !hasDatabaseUrl() ||
    !normalizedVideoId ||
    !Number.isInteger(input.userId) ||
    input.userId <= 0
  ) {
    return {
      ok: false as const,
      removedItemCount: 0,
      removedFromPlaylistIds: [] as string[],
      deletedPlaylistIds: [] as string[],
      activePlaylistDeleted: false,
    };
  }

  const hideResult = await hideVideoForUser({
    userId: input.userId,
    videoId: normalizedVideoId,
  });

  if (!hideResult.ok) {
    return {
      ok: false as const,
      removedItemCount: 0,
      removedFromPlaylistIds: [] as string[],
      deletedPlaylistIds: [] as string[],
      activePlaylistDeleted: false,
    };
  }

  try {
    // ── Optimized batch path ────────────────────────────────────────────────
    // 1. Find all playlist items referencing the hidden video across all user playlists
    const itemsToRemove = await findPlaylistItemsByVideoIdBatch(
      input.userId,
      normalizedVideoId,
    );

    if (itemsToRemove.length === 0) {
      return {
        ok: true as const,
        removedItemCount: 0,
        removedFromPlaylistIds: [] as string[],
        deletedPlaylistIds: [] as string[],
        activePlaylistDeleted: false,
      };
    }

    // 2. Batch-delete all found items
    const { removedCount, affectedPlaylistIds } =
      await batchRemovePlaylistItems(itemsToRemove);

    // 3. Find and delete playlists that are now empty
    const affectedIds = [...affectedPlaylistIds];
    const deletedPlaylistIds = await batchDeleteEmptyPlaylists(
      affectedIds,
      input.userId,
    );

    return {
      ok: true as const,
      removedItemCount: removedCount,
      removedFromPlaylistIds: affectedIds,
      deletedPlaylistIds: [...deletedPlaylistIds],
      activePlaylistDeleted: Boolean(
        input.activePlaylistId && deletedPlaylistIds.has(input.activePlaylistId),
      ),
    };
  } catch {
    // Keep block/hide resilient even if batch pruning fails.
    return {
      ok: true as const,
      removedItemCount: 0,
      removedFromPlaylistIds: [] as string[],
      deletedPlaylistIds: [] as string[],
      activePlaylistDeleted: false,
    };
  }
}

export async function unhideVideoForUser(input: { userId: number; videoId: string }) {
  const normalizedVideoId = normalizeYouTubeVideoId(input.videoId);
  if (
    !hasDatabaseUrl() ||
    !normalizedVideoId ||
    !Number.isInteger(input.userId) ||
    input.userId <= 0
  ) {
    return { ok: false as const };
  }

  try {
    await prisma.$executeRawUnsafe(
      `
        DELETE FROM hidden_videos
        WHERE user_id = ? AND video_id = ?
      `,
      input.userId,
      normalizedVideoId,
    );

    updateCachedHiddenVideoIdsForUser(input.userId, normalizedVideoId, false);

    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
}

export async function filterHiddenVideos<T extends { id: string } | { videoId: string }>(
  videos: T[],
  userId?: number,
): Promise<T[]> {
  if (!userId || !hasDatabaseUrl()) {
    return videos;
  }

  const videoIds = videos.map((video) => ("videoId" in video ? video.videoId : video.id));
  const hiddenIds = await getHiddenVideoMatchesForUser(userId, videoIds);
  if (hiddenIds.size === 0) {
    return videos;
  }

  return videos.filter((video) => {
    const videoId = "videoId" in video ? video.videoId : video.id;
    return !hiddenIds.has(videoId);
  });
}

export function clearHiddenVideoIdsCaches() {
  hiddenVideoIdsCache.clear();
  hiddenVideoIdsInFlight.clear();
}