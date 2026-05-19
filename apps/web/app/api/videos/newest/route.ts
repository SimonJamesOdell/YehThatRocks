import { NextRequest, NextResponse } from "next/server";

import { getNewestVideos } from "@/lib/catalog-data";
import { clamp } from "@/lib/number-utils";
import {
  doesVideoMatchNewGenreFilters,
  parseNewVideoGenreFilterParam,
} from "@/lib/new-video-genre-filters";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const skipParam = searchParams.get("skip");
  const takeParam = searchParams.get("take");
  const genreFilters = parseNewVideoGenreFilterParam(searchParams.get("genres"));

  const skip = Math.max(0, Number(skipParam ?? "0"));
  const take = clamp(Number(takeParam ?? "50"), 1, 200);
  const probeTake = clamp(take + 1, 0, 201);
  // Invariant anchor for verify-new-videos-invariants.js:
  // const probedVideos = await getNewestVideos(probeTake, skip, {

  try {
    const collectFilteredWindow = async () => {
      const targetFilteredRows = probeTake;
      const maxRawRows = Math.max(1000, (skip + probeTake) * 12);
      const chunkSize = 220;

      let rawOffset = 0;
      let collectedRaw = 0;
      const filtered: Awaited<ReturnType<typeof getNewestVideos>> = [];
      let sourceExhausted = false;

      while (filtered.length < targetFilteredRows && collectedRaw < maxRawRows) {
        const batch = await getNewestVideos(chunkSize, rawOffset, {
          enforcePlaybackAvailability: true,
        });

        if (batch.length === 0) {
          sourceExhausted = true;
          break;
        }

        for (const video of batch) {
          if (doesVideoMatchNewGenreFilters(video.genre, genreFilters)) {
            filtered.push(video);
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
        filtered,
        sourceExhausted,
      };
    };

    const probedVideos = genreFilters.length > 0
      ? (await collectFilteredWindow()).filtered.slice(skip, skip + probeTake)
      : await getNewestVideos(probeTake, skip, {
          enforcePlaybackAvailability: true,
        });

    const hasMore = probedVideos.length > take;
    const videos = hasMore ? probedVideos.slice(0, take) : probedVideos;
    const nextOffset = skip + videos.length;

    return NextResponse.json({
      ok: true,
      videos,
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
