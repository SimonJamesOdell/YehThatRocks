import { NextRequest, NextResponse } from "next/server";

import { getCategoryArtistsByGenre, getGenreBySlug } from "@/lib/catalog-data";
import { OPERATIONAL_RETRY_LATER_MESSAGE } from "@/lib/operational-error-copy";

type CategoryArtistsRouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: NextRequest, context: CategoryArtistsRouteContext) {
  try {
    const limitParam = request.nextUrl.searchParams.get("limit");
    const offsetParam = request.nextUrl.searchParams.get("offset");
    const limit = Math.max(1, Math.min(96, Number.parseInt(limitParam ?? "48", 10) || 48));
    const offset = Math.max(0, Number.parseInt(offsetParam ?? "0", 10) || 0);
    const { slug } = await context.params;
    const genre = await getGenreBySlug(slug);

    if (!genre) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    const artistsWithProbe = await getCategoryArtistsByGenre(genre, { offset, limit: limit + 1 });
    const hasMore = artistsWithProbe.length > limit;
    const artists = artistsWithProbe.slice(0, limit);

    return NextResponse.json({
      genre,
      artists,
      hasMore,
      nextOffset: offset + artists.length,
    });
  } catch (error) {
    console.error("[api/categories/[slug]/artists] failed", {
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
