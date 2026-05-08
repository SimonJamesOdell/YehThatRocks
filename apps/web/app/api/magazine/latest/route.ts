import { NextRequest, NextResponse } from "next/server";

import { getPublishedArticles } from "@/lib/magazine-data";

export async function GET(request: NextRequest) {
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") || "8");
  const limit = Math.max(1, Math.min(20, Number.isFinite(rawLimit) ? rawLimit : 8));

  try {
    const articles = await getPublishedArticles(limit);

    return NextResponse.json({
      articles: articles.map((article) => ({
        slug: article.slug,
        videoId: article.videoId,
        title: article.title,
        artist: article.artist,
        genre: article.genre,
      })),
    });
  } catch {
    return NextResponse.json({ articles: [] });
  }
}
