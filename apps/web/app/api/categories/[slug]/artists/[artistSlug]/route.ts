import { NextRequest, NextResponse } from "next/server";

import { filterHiddenVideos, getCategoryArtistsByGenre, getGenreBySlug, getVideosByGenreAndArtist } from "@/lib/catalog-data";
import { getOptionalApiAuth } from "@/lib/auth-request";
import { OPERATIONAL_RETRY_LATER_MESSAGE } from "@/lib/operational-error-copy";

type CategoryArtistVideosRouteContext = {
  params: Promise<{ slug: string; artistSlug: string }>;
};

export async function GET(request: NextRequest, context: CategoryArtistVideosRouteContext) {
  try {
    const limitParam = request.nextUrl.searchParams.get("limit");
    const offsetParam = request.nextUrl.searchParams.get("offset");
    const nameParam = (request.nextUrl.searchParams.get("name") ?? "").trim();
    const limit = Math.max(1, Math.min(96, Number.parseInt(limitParam ?? "48", 10) || 48));
    const offset = Math.max(0, Number.parseInt(offsetParam ?? "0", 10) || 0);
    const { slug, artistSlug } = await context.params;
    const genre = await getGenreBySlug(slug);

    if (!genre) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    let artistName = nameParam;
    if (!artistName) {
      const firstBatch = await getCategoryArtistsByGenre(genre, { offset: 0, limit: 200 });
      artistName = firstBatch.find((artist) => artist.slug === artistSlug)?.name ?? "";
    }

    if (!artistName) {
      return NextResponse.json({ error: "Artist not found in category" }, { status: 404 });
    }

    const videosWithProbe = await getVideosByGenreAndArtist(genre, artistName, { offset, limit: limit + 1 });

    const authResult = await getOptionalApiAuth(request);
    let filteredVideos = videosWithProbe;
    if (authResult?.userId) {
      filteredVideos = await filterHiddenVideos(videosWithProbe, authResult.userId);
    }

    const hasMore = filteredVideos.length > limit;
    const videos = filteredVideos.slice(0, limit);

    return NextResponse.json({
      genre,
      artistName,
      videos,
      hasMore,
      nextOffset: offset + videos.length,
    });
  } catch (error) {
    console.error("[api/categories/[slug]/artists/[artistSlug]] failed", {
      message: error instanceof Error ? error.message : "unknown error",
      path: request.nextUrl.pathname,
      query: request.nextUrl.search,
    });

    return NextResponse.json(
      {
        error: OPERATIONAL_RETRY_LATER_MESSAGE,
      },
      { status: 503 },
    );
  }
}
