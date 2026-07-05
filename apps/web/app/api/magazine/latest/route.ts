import { NextRequest, NextResponse } from "next/server";

import { getPublishedArticlesPaginated, pruneUnavailableArticles } from "@/lib/magazine-data";

export async function GET(request: NextRequest) {
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") || "8");
  const rawOffset = Number(request.nextUrl.searchParams.get("offset") || "0");
  const limit = Math.max(1, Math.min(20, Number.isFinite(rawLimit) ? rawLimit : 8));
  const offset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);

  try {
    // Preflight: prune unavailable articles (capped at 4 s)
    await Promise.race([
      pruneUnavailableArticles(),
      new Promise<number>((resolve) => setTimeout(() => resolve(0), 4000)),
    ]);

    const { articles, hasMore, total } = await getPublishedArticlesPaginated(limit, offset);

    return NextResponse.json({
      articles: articles.map((article) => ({
        slug: article.slug,
        videoId: article.videoId,
        title: article.title,
        artist: article.artist,
        kicker: article.kicker,
        genre: article.genre,
      })),
      hasMore,
      total,
      offset,
    });
  } catch {
    return NextResponse.json({ articles: [], hasMore: false, total: 0, offset });
  }
}
