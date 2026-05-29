import { NextResponse } from "next/server";

import { getRuntimeCachedTopLevelGenreCards } from "@/lib/catalog-data";
import { TOP_LEVEL_GENRE_BUCKETS } from "@/lib/genre-buckets";
import type { GenreCard } from "@/lib/catalog-data-utils";

export async function GET() {
  const fallbackCards: GenreCard[] = TOP_LEVEL_GENRE_BUCKETS.map((bucket) => ({
    genre: bucket.label,
    previewVideoId: null,
    artistCount: 0,
  }));

  const cards = await getRuntimeCachedTopLevelGenreCards()
    .then((runtimeCards) => {
      if (runtimeCards && runtimeCards.some((card) => card.previewVideoId || Number(card.artistCount ?? 0) > 0)) {
        return runtimeCards;
      }
      return fallbackCards;
    })
    .catch(() => fallbackCards);

  return NextResponse.json({ cards }, {
    headers: {
      "Cache-Control": "private, max-age=300, stale-while-revalidate=1800",
    },
  });
}
