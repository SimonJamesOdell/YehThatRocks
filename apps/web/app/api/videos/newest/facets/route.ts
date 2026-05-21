import { NextRequest, NextResponse } from "next/server";

import { getGenreCards } from "@/lib/catalog-data";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const windowParam = searchParams.get("window");
  const windowSize = Number(windowParam ?? "0");

  try {
    const categories = await getGenreCards();
    const genres = categories
      .map((category) => ({
        genre: category.genre,
        count: Number(category.artistCount ?? 0),
      }))
      .filter((facet) => facet.genre.trim().length > 0)
      .sort((a, b) => a.genre.localeCompare(b.genre));

    return NextResponse.json({
      ok: true,
      window: windowSize,
      totalVideos: genres.length,
      genres,
    }, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to build newest genre facets",
      },
      { status: 500 },
    );
  }
}
