import { NextResponse } from "next/server";

import { getCategoryArtistsByGenre, getGenreCards } from "@/lib/catalog-data";

export async function GET() {
  const startedAt = Date.now();

  try {
    let categories = await getGenreCards();

    // Safety net: if card-level counts collapse to zero, recompute from the
    // same source used by category artist pages so parent cards stay accurate.
    if (categories.length > 0 && categories.every((category) => Number(category.artistCount ?? 0) === 0)) {
      categories = await Promise.all(
        categories.map(async (category) => {
          const artists = await getCategoryArtistsByGenre(category.genre, { offset: 0, limit: 2_000 });
          return {
            ...category,
            artistCount: artists.length,
          };
        }),
      );
    }

    const durationMs = Date.now() - startedAt;

    return NextResponse.json(
      {
        categories,
        meta: {
          count: categories.length,
          durationMs,
        },
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : "unknown error";

    return NextResponse.json(
      {
        categories: [],
        meta: {
          count: 0,
          durationMs,
          error: message,
        },
      },
      { status: 503 },
    );
  }
}
