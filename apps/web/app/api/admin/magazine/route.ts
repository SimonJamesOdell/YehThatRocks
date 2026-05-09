import { NextRequest, NextResponse } from "next/server";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";

type MagazineListRow = {
  slug: string;
  title: string;
  videoId: string | null;
  publishedAt: Date;
  externalLandings: bigint | number;
};

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const withLandings = await prisma.$queryRaw<MagazineListRow[]>`
    SELECT
      m.slug AS slug,
      m.title AS title,
      m.video_id AS videoId,
      m.published_at AS publishedAt,
      COALESCE(l.external_landings, 0) AS externalLandings
    FROM magazine_articles m
    LEFT JOIN (
      SELECT article_slug, COUNT(*) AS external_landings
      FROM magazine_article_external_landings
      GROUP BY article_slug
    ) l ON l.article_slug = m.slug
    WHERE m.status = 'published'
    ORDER BY m.published_at DESC
  `.catch(() => []);

  const rows = withLandings.length > 0
    ? withLandings
    : await prisma.$queryRaw<MagazineListRow[]>`
        SELECT
          m.slug AS slug,
          m.title AS title,
          m.video_id AS videoId,
          m.published_at AS publishedAt,
          0 AS externalLandings
        FROM magazine_articles m
        WHERE m.status = 'published'
        ORDER BY m.published_at DESC
      `.catch(() => []);

  return NextResponse.json({
    ok: true,
    articles: rows.map((row) => ({
      slug: row.slug,
      title: row.title,
      videoId: row.videoId,
      publishedAt: row.publishedAt instanceof Date ? row.publishedAt.toISOString() : String(row.publishedAt),
      externalLandings: Number(row.externalLandings ?? 0),
    })),
  });
}
