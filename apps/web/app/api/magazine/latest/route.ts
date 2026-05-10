import { NextRequest, NextResponse } from "next/server";

import { getPublishedArticles, pruneUnavailableArticles } from "@/lib/magazine-data";

export async function GET(request: NextRequest) {
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") || "8");
  const limit = Math.max(1, Math.min(20, Number.isFinite(rawLimit) ? rawLimit : 8));

  try {
    // Preflight: delete articles whose YouTube videos have been removed.
    // Capped at 4 s so a slow YouTube response never blocks the listing.
    await Promise.race([
      pruneUnavailableArticles(),
      new Promise<number>((resolve) => setTimeout(() => resolve(0), 4000)),
    ]);

    const articles = await getPublishedArticles(limit);

    return NextResponse.json({
      articles: articles.map((article) => ({
        slug: article.slug,
        videoId: article.videoId,
        title: article.title,
        artist: article.artist,
        kicker: article.kicker,
        genre: article.genre,
      })),
    });
  } catch {
    return NextResponse.json({ articles: [] });
  }
}
