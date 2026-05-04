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

  const requestedScreenName = screenName?.trim();

  if (!hasDatabaseUrl() || !requestedScreenName) {
    return empty;
  }

  try {
    const userIdMatch = /^user-(\d+)$/i.exec(requestedScreenName);
    const requestedUserId = userIdMatch ? Number(userIdMatch[1]) : null;

    const userRow = requestedUserId !== null
      ? await prisma.user.findUnique({
          where: { id: requestedUserId },
          select: {
            id: true,
            screenName: true,
            email: true,
            avatarUrl: true,
            bio: true,
            location: true,
          },
        })
      : await prisma.user.findFirst({
          where: {
            OR: [
              { screenName: requestedScreenName },
              {
                screenName: null,
                email: {
                  not: null,
                  startsWith: `${requestedScreenName}@`,
                },
              },
            ],
          },
          select: {
            id: true,
            screenName: true,
            email: true,
            avatarUrl: true,
            bio: true,
            location: true,
          },
          orderBy: { id: "asc" },
        });

    if (!userRow) {
      return empty;
    }

    const userId = Number(userRow.id);

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
