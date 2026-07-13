import { prisma } from "@/lib/db";

interface MagazineFeedRow {
  slug: string;
  title: string;
  deck: string | null;
  artist: string;
  genre: string;
  body: string;
  publishedAt: Date | string;
}

const SITE_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") ||
  "https://yehthatrocks.com";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatRfc822Date(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toUTCString();
}

function buildUtmParams(campaign: string): string {
  return new URLSearchParams({
    utm_source: "rss",
    utm_medium: "feed",
    utm_campaign: campaign,
  }).toString();
}

export const dynamic = "force-dynamic";
export const revalidate = 3600;

export async function GET() {
  // During Docker build, DATABASE_URL is not available and the prisma proxy
  // throws. Return an empty RSS feed as the build-time prerender fallback;
  // ISR will populate real data at runtime on the first request.
  if (!process.env.DATABASE_URL) {
    const emptyXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>YehThatRocks — Rock &amp; Metal Magazine</title>
    <link>${SITE_ORIGIN}/magazine</link>
    <description>Rock and metal magazine articles from YehThatRocks</description>
    <atom:link href="${SITE_ORIGIN}/feed/magazine.xml" rel="self" type="application/rss+xml"/>
  </channel>
</rss>`;
    return new Response(emptyXml, {
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
    });
  }

  const rows = await prisma.$queryRawUnsafe<MagazineFeedRow[]>(
    `SELECT slug, title, deck, artist, genre, body, published_at AS publishedAt
     FROM magazine_articles
     WHERE status = 'published'
     ORDER BY published_at DESC
     LIMIT 30`,
  );

  const utm = buildUtmParams("magazine");

  const items = rows
    .map((row) => {
      const itemTitle = escapeXml(row.title);
      const link = `${SITE_ORIGIN}/magazine/${escapeXml(row.slug)}?${utm}`;
      const pubDate = formatRfc822Date(row.publishedAt);

      let descriptionHtml: string;
      if (row.deck?.trim()) {
        descriptionHtml = `<p>${escapeXml(row.deck.trim())}</p>`;
      } else {
        const bodySnippet = (row.body ?? "").slice(0, 300);
        descriptionHtml = `<p>${escapeXml(bodySnippet)}</p>`;
      }

      const guid = escapeXml(row.slug);

      return `    <item>
      <title>${itemTitle}</title>
      <link>${link}</link>
      <description><![CDATA[${descriptionHtml}]]></description>
      <pubDate>${pubDate}</pubDate>
      <guid isPermaLink="false">${guid}</guid>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>YehThatRocks — Rock &amp; Metal Magazine</title>
    <link>${SITE_ORIGIN}/magazine</link>
    <description>Rock and metal magazine articles from YehThatRocks</description>
    <atom:link href="${SITE_ORIGIN}/feed/magazine.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
