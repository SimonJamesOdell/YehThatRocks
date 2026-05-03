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
import {
  getPlaylists,
  getPlaylistById,
  removePlaylistItem,
  deletePlaylist,
} from "@/lib/catalog-data-playlists";
import { clearFavouritesCacheForUser } from "@/lib/catalog-data-favourites";

// ── Constants & caches ────────────────────────────────────────────────────────

const USER_SCOPED_CACHE_MAX_ENTRIES = Math.max(
  100,
  Math.min(10_000, Number(process.env.USER_SCOPED_CACHE_MAX_ENTRIES || "1500")),
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

  const ids = new Set(
    rows.map((row) => row.videoId).filter((videoId): videoId is string => Boolean(videoId)),
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
      candidateVideoIds.filter((id) => typeof id === "string" && id.length > 0),
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
      .filter((row) => typeof row.videoId === "string" && row.videoId.length > 0)
      .map((row) => ({
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
    const removedFavourite = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `
          INSERT INTO hidden_videos (user_id, video_id)
          VALUES (?, ?)
          ON DUPLICATE KEY UPDATE video_id = VALUES(video_id)
        `,
        input.userId,
        normalizedVideoId,
      );

      const removed = await tx.favourite.deleteMany({
        where: {
          userid: input.userId,
          videoId: normalizedVideoId,
        },
      });

      return removed.count > 0;
    });

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

  const removedFromPlaylistIds = new Set<string>();
  const deletedPlaylistIds = new Set<string>();
  let removedItemCount = 0;

  try {
    const playlists = await getPlaylists(input.userId);

    for (const playlist of playlists) {
      let current = await getPlaylistById(playlist.id, input.userId);

      if (!current || current.videos.length === 0) {
        continue;
      }

      let matchIndex = current.videos.findIndex(
        (video) => (normalizeYouTubeVideoId(video.id) ?? video.id) === normalizedVideoId,
      );

      while (matchIndex >= 0) {
        const match = current.videos[matchIndex];
        const updated = await removePlaylistItem(
          playlist.id,
          matchIndex,
          input.userId,
          match?.playlistItemId ?? null,
        );

        if (!updated) {
          break;
        }

        removedItemCount += 1;
        removedFromPlaylistIds.add(playlist.id);
        current = updated;
        matchIndex = current.videos.findIndex(
          (video) =>
            (normalizeYouTubeVideoId(video.id) ?? video.id) === normalizedVideoId,
        );
      }

      if (!removedFromPlaylistIds.has(playlist.id)) {
        continue;
      }

      const refreshed = await getPlaylistById(playlist.id, input.userId);

      if (!refreshed || refreshed.videos.length === 0) {
        const deleted = await deletePlaylist(playlist.id, input.userId);
        if (deleted) {
          deletedPlaylistIds.add(playlist.id);
        }
      }
    }
  } catch {
    // Keep block/hide resilient even if playlist pruning partially fails.
  }

  return {
    ok: true as const,
    removedItemCount,
    removedFromPlaylistIds: [...removedFromPlaylistIds],
    deletedPlaylistIds: [...deletedPlaylistIds],
    activePlaylistDeleted: Boolean(
      input.activePlaylistId && deletedPlaylistIds.has(input.activePlaylistId),
    ),
  };
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
