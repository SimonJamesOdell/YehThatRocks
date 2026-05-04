/**
 * catalog-data-users.ts
 * Public user profile and public playlist videos.
 */

import { prisma } from "@/lib/db";
import type { VideoRecord } from "@/lib/catalog";
import type { PublicUserProfile, PlaylistSummary } from "@/lib/catalog-data-utils";
import { hasDatabaseUrl } from "@/lib/catalog-data-utils";
import { getFavouriteVideos } from "@/lib/catalog-data-favourites";
import { getPlaylists, getPlaylistById } from "@/lib/catalog-data-playlists";

export async function getPublicUserProfile(screenName: string): Promise<{
  user: PublicUserProfile | null;
  favourites: VideoRecord[];
  playlists: PlaylistSummary[];
}> {
  const empty = { user: null, favourites: [], playlists: [] };

  if (!hasDatabaseUrl() || !screenName?.trim()) {
    return empty;
  }

  try {
    const rows = await prisma.$queryRaw<
      Array<{
        id: number | bigint;
        screenName: string | null;
        email: string | null;
        avatarUrl: string | null;
        bio: string | null;
        location: string | null;
        createdAt: Date | string | null;
      }>
    >`
      SELECT id, screen_name AS screenName, email, avatar_url AS avatarUrl, bio, location, created_at AS createdAt
      FROM users
      WHERE screen_name = ${screenName.trim()}
      LIMIT 1
    `;

    const userRow = rows[0];

    if (!userRow) {
      return empty;
    }

    const userId =
      typeof userRow.id === "bigint" ? Number(userRow.id) : Number(userRow.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      return empty;
    }

    const emailName =
      typeof userRow.email === "string" && userRow.email.includes("@")
        ? userRow.email.split("@")[0]
        : null;

    const user: PublicUserProfile = {
      id: userId,
      screenName: userRow.screenName ?? emailName ?? `user-${userId}`,
      avatarUrl: userRow.avatarUrl,
      bio: userRow.bio,
      location: userRow.location,
      joinedAt:
        userRow.createdAt
          ? new Date(userRow.createdAt).toISOString()
          : new Date(0).toISOString(),
    };

    const [favourites, playlists] = await Promise.all([
      getFavouriteVideos(userId),
      getPlaylists(userId),
    ]);

    return { user, favourites, playlists };
  } catch {
    return empty;
  }
}

export async function getPublicPlaylistVideos(
  userId: number,
  playlistId: string,
): Promise<VideoRecord[]> {
  if (!hasDatabaseUrl()) {
    return [];
  }

  try {
    const playlist = await getPlaylistById(playlistId, userId);
    return playlist?.videos ?? [];
  } catch {
    return [];
  }
}
