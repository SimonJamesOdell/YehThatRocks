import { NextRequest, NextResponse } from "next/server";

import {
  getArtistsByGenre,
  getCachedCategoryArtistsByGenre,
  getCategoryArtistTabCountsByGenre,
  getCategoryArtistsByGenre,
  getGenreBySlug,
  warmCategoryArtistRuntimeCacheByGenre,
} from "@/lib/catalog-data";

type CategoryArtistsRouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: NextRequest, context: CategoryArtistsRouteContext) {
  try {
    const limitParam = request.nextUrl.searchParams.get("limit");
    const offsetParam = request.nextUrl.searchParams.get("offset");
    const includeTabCounts = request.nextUrl.searchParams.get("includeTabCounts") === "1";
    const wantsFullPayload = request.nextUrl.searchParams.get("full") === "1";
    const shouldWarmRuntimeCache = request.nextUrl.searchParams.get("warm") === "1";
    const maxLimit = wantsFullPayload ? 25_000 : 192;
    const defaultLimit = wantsFullPayload ? 25_000 : 96;
    const limit = Math.max(1, Math.min(maxLimit, Number.parseInt(limitParam ?? String(defaultLimit), 10) || defaultLimit));
    const offset = Math.max(0, Number.parseInt(offsetParam ?? "0", 10) || 0);
    const { slug } = await context.params;
    const genre = await getGenreBySlug(slug);

    if (!genre) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    if (shouldWarmRuntimeCache) {
      await warmCategoryArtistRuntimeCacheByGenre(genre);
    }

    let artistsWithProbe: Awaited<ReturnType<typeof getCategoryArtistsByGenre>> = [];
    let tabCounts: Awaited<ReturnType<typeof getCategoryArtistTabCountsByGenre>> | null = null;
    const useCacheOnlyFullPayload = wantsFullPayload && !shouldWarmRuntimeCache;

    try {
      const artistRowsPromise = useCacheOnlyFullPayload
        ? getCachedCategoryArtistsByGenre(genre, { offset, limit: limit + 1 })
        : getCategoryArtistsByGenre(genre, { offset, limit: limit + 1, maxLimit: maxLimit + 1 });
      const results = await Promise.all([
        artistRowsPromise,
        offset === 0 && includeTabCounts && !useCacheOnlyFullPayload ? getCategoryArtistTabCountsByGenre(genre) : Promise.resolve(null),
      ]);
      artistsWithProbe = results[0] ?? [];
      tabCounts = results[1];

      if (useCacheOnlyFullPayload && offset === 0 && includeTabCounts && artistsWithProbe.length > 0) {
        tabCounts = await getCategoryArtistTabCountsByGenre(genre);
      }
    } catch (error) {
      console.warn("[api/categories/[slug]/artists] primary query degraded", {
        message: error instanceof Error ? error.message : "unknown error",
        slug,
        genre,
        limit,
        offset,
      });

      try {
        const allArtists = await getArtistsByGenre(genre);
        const fallbackArtists = allArtists
          .slice(offset, offset + limit + 1)
          .map((artist) => ({
            name: artist.name,
            slug: artist.slug,
            videoCount: 0,
            thumbnailVideoId: null,
            dominantGenre: artist.genre,
          }));

        artistsWithProbe = fallbackArtists;
        if (offset === 0 && includeTabCounts) {
          tabCounts = { all: allArtists.length };
        }
      } catch (fallbackError) {
        console.error("[api/categories/[slug]/artists] fallback getArtistsByGenre failed", {
          message: fallbackError instanceof Error ? fallbackError.message : "unknown error",
          slug,
          genre,
        });
      }
    }

    const artists = artistsWithProbe.slice(0, limit);
    const totalArtists = offset === 0 ? (tabCounts?.all ?? (useCacheOnlyFullPayload && artists.length > 0 ? artists.length : null)) : null;
    const hasMore = useCacheOnlyFullPayload && artistsWithProbe.length === 0
      ? true
      : artistsWithProbe.length > limit;

    return NextResponse.json({
      genre,
      artists,
      totalArtists,
      tabCounts,
      hasMore,
      nextOffset: offset + artists.length,
    });
  } catch (error) {
    console.error("[api/categories/[slug]/artists] failed", {
      message: error instanceof Error ? error.message : "unknown error",
      path: request.nextUrl.pathname,
      query: request.nextUrl.search,
    });

    return NextResponse.json({ error: "Unable to load category artists" }, { status: 500 });
  }
}
