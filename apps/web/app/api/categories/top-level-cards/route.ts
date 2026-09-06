import { NextResponse } from "next/server";

import { noteBenignActivity } from "@/lib/trust";

import { getRuntimeCachedTopLevelGenreCards } from "@/lib/catalog-data";
import { ensureCategoriesNewSnapshotReady } from "@/lib/categories-new-snapshots";
import { TOP_LEVEL_GENRE_BUCKETS } from "@/lib/genre-buckets";
import type { GenreCard } from "@/lib/catalog-data-utils";

export async function GET(request: Request) {
  noteBenignActivity(request);

  const url = new URL(request.url);
  const shouldEnsureSnapshot = url.searchParams.get("ensureSnapshot") === "1";
  const shouldWaitForSnapshot = url.searchParams.get("waitForSnapshot") === "1";

  if (shouldEnsureSnapshot) {
    const snapshotWaitMs = Math.max(0, Number(url.searchParams.get("snapshotWaitMs") ?? (shouldWaitForSnapshot ? 180_000 : 0)));
    const ensurePromise = ensureCategoriesNewSnapshotReady({
      maxWaitMs: snapshotWaitMs,
      pollMs: 1_000,
    });

    if (shouldWaitForSnapshot) {
      await ensurePromise.catch(() => false);
    } else {
      void ensurePromise.catch(() => undefined);
    }
  }

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
