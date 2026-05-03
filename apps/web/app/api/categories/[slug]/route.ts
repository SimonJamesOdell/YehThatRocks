import { NextRequest, NextResponse } from "next/server";

import { filterHiddenVideos, getArtistsByGenre, getGenreBySlug, getVideosByGenre } from "@/lib/catalog-data";
import { getOptionalApiAuth } from "@/lib/auth-request";

type CategoryRouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(_request: NextRequest, context: CategoryRouteContext) {
  try {
    const limitParam = _request.nextUrl.searchParams.get("limit");
    const offsetParam = _request.nextUrl.searchParams.get("offset");
    const includeArtists = _request.nextUrl.searchParams.get("includeArtists") === "1";
    const limit = Math.max(1, Math.min(96, Number.parseInt(limitParam ?? "48", 10) || 48));
    const offset = Math.max(0, Number.parseInt(offsetParam ?? "0", 10) || 0);
    const { slug } = await context.params;
    const genre = await getGenreBySlug(slug);

    if (!genre) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    const videosWithProbe = await getVideosByGenre(genre, { offset, limit: limit + 1 });

    // Filter blocked videos if user is authenticated
    const authResult = await getOptionalApiAuth(_request);
    let filteredVideos = videosWithProbe;
    if (authResult?.userId) {
      filteredVideos = await filterHiddenVideos(videosWithProbe, authResult.userId);
    }

    let artists: Awaited<ReturnType<typeof getArtistsByGenre>> | undefined;
    if (includeArtists) {
      artists = await getArtistsByGenre(genre);
    }

    const hasMore = filteredVideos.length > limit;
    const videos = filteredVideos.slice(0, limit);

    return NextResponse.json({
      genre,
      videos,
      artists,
      hasMore,
      nextOffset: offset + videos.length,
    });
  } catch (error) {
    console.error("[api/categories/[slug]] failed", {
      message: error instanceof Error ? error.message : "unknown error",
      path: _request.nextUrl.pathname,
      query: _request.nextUrl.search,
    });

    return NextResponse.json(
      {
        error: "The system cannot serve this request right now. Please try again later.",
      },
      { status: 503 },
    );
  }
}
