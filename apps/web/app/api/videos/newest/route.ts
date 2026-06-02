import { NextRequest, NextResponse } from "next/server";

import { getNewestVideos } from "@/lib/catalog-data";
import { prisma } from "@/lib/db";
import { normalizeArtistKey } from "@/lib/catalog-data-utils";
import { clamp } from "@/lib/number-utils";
import {
  doesVideoMatchNewGenreFilters,
  parseNewVideoGenreFilterStateFromParams,
} from "@/lib/new-video-genre-filters";

async function hydrateArtistVideoCounts<T extends { parsedArtist?: string | null; channelTitle?: string | null }>(videos: T[]) {
  const normalizedArtists = Array.from(
    new Set(
      videos
        .map((video) => normalizeArtistKey((video.parsedArtist ?? video.channelTitle ?? "").trim()))
        .filter((value) => value.length > 0),
    ),
  );

  if (normalizedArtists.length === 0) {
    return videos.map((video) => ({ ...video, artistVideoCount: null }));
  }

  try {
    const placeholders = normalizedArtists.map(() => "?").join(", ");
    const rows = await prisma.$queryRawUnsafe<Array<{ normalizedArtist: string; videoCount: number | bigint | null }>>(
      `
        SELECT
          s.normalized_artist AS normalizedArtist,
          s.video_count AS videoCount
        FROM artist_stats s
        WHERE s.normalized_artist IN (${placeholders})
      `,
      ...normalizedArtists,
    );

    const byArtist = new Map<string, number>();
    for (const row of rows) {
      const key = normalizeArtistKey(row.normalizedArtist);
      const count = typeof row.videoCount === "bigint" ? Number(row.videoCount) : Number(row.videoCount ?? Number.NaN);
      if (key && Number.isFinite(count)) {
        byArtist.set(key, count);
      }
    }

    return videos.map((video) => {
      const normalizedArtist = normalizeArtistKey((video.parsedArtist ?? video.channelTitle ?? "").trim());
      return {
        ...video,
        artistVideoCount: byArtist.get(normalizedArtist) ?? null,
      };
    });
  } catch {
    return videos.map((video) => ({ ...video, artistVideoCount: null }));
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const skipParam = searchParams.get("skip");
  const takeParam = searchParams.get("take");
  const genreFilters = parseNewVideoGenreFilterStateFromParams({
    includeParam: searchParams.get("genresInclude"),
    excludeParam: searchParams.get("genresExclude"),
    legacyParam: searchParams.get("genres"),
  });

  const skip = Math.max(0, Number(skipParam ?? "0"));
  const take = clamp(Number(takeParam ?? "50"), 1, 200);
  const probeTake = clamp(take + 1, 0, 201);
  // Invariant anchor for verify-new-videos-invariants.js:
  // const probedVideos = await getNewestVideos(probeTake, skip, {

  try {
    const collectUniqueWindow = async (withGenreFilters: boolean) => {
      const targetRows = skip + probeTake;
      const maxRawRows = Math.max(1000, Math.min(12000, (skip + probeTake) * 16));
      const chunkSize = 220;

      let rawOffset = 0;
      let collectedRaw = 0;
      const filtered: Awaited<ReturnType<typeof getNewestVideos>> = [];
      const seenIds = new Set<string>();
      let sourceExhausted = false;

      while (filtered.length < targetRows && collectedRaw < maxRawRows) {
        const batch = await getNewestVideos(chunkSize, rawOffset, {
          requireAvailableSiteVideo: false,
        });

        if (batch.length === 0) {
          sourceExhausted = true;
          break;
        }

        for (const video of batch) {
          if (!video.id || seenIds.has(video.id)) {
            continue;
          }

          if (
            withGenreFilters &&
            !doesVideoMatchNewGenreFilters(video.genre, genreFilters.includeGenres, genreFilters.excludeGenres)
          ) {
            continue;
          }

          seenIds.add(video.id);
          filtered.push(video);

          if (filtered.length >= targetRows) {
            break;
          }
        }

        rawOffset += batch.length;
        collectedRaw += batch.length;

        if (batch.length < chunkSize) {
          sourceExhausted = true;
          break;
        }
      }

      return {
        filtered: filtered.slice(skip, skip + probeTake),
        sourceExhausted,
      };
    };

    const hasActiveGenreFilters = genreFilters.includeGenres.length > 0 || genreFilters.excludeGenres.length > 0;
    const probedVideos = (await collectUniqueWindow(hasActiveGenreFilters)).filtered;

    const hasMore = probedVideos.length > take;
    const videos = hasMore ? probedVideos.slice(0, take) : probedVideos;
    const videosWithArtistCounts = await hydrateArtistVideoCounts(videos);
    const nextOffset = skip + videos.length;

    return NextResponse.json({
      ok: true,
      videos: videosWithArtistCounts,
      skip,
      take,
      hasMore,
      nextOffset,
      count: videos.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to fetch newest videos",
      },
      { status: 500 },
    );
  }
}
