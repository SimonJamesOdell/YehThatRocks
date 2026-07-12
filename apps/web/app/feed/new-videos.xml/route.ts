import { prisma } from "@/lib/db";

interface VideoFeedRow {
  videoId: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
  title: string;
  genre: string | null;
  thumbnail: string | null;
  createdAt: Date | string;
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

export const revalidate = 3600;

export async function GET() {
  // During Docker build, DATABASE_URL is not available and the prisma proxy
  // throws. Return an empty RSS feed as the build-time prerender fallback;
  // ISR will populate real data at runtime on the first request.
  if (!process.env.DATABASE_URL) {
    const emptyXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>YehThatRocks — New Rock &amp; Metal Videos</title>
    <link>${SITE_ORIGIN}</link>
    <description>The latest rock and metal videos on YehThatRocks</description>
    <atom:link href="${SITE_ORIGIN}/feed/new-videos.xml" rel="self" type="application/rss+xml"/>
  </channel>
</rss>`;
    return new Response(emptyXml, {
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
    });
  }

  const rows = await prisma.$queryRawUnsafe<VideoFeedRow[]>(
    `SELECT
       v.videoId,
       v.parsedArtist,
       v.parsedTrack,
       v.title,
       v.genre,
       v.thumbnail,
       v.created_at AS createdAt
     FROM videos v
     INNER JOIN site_videos sv ON sv.video_id = v.id
     WHERE v.approved = 1 AND sv.status = 'available'
     ORDER BY v.created_at DESC
     LIMIT 50`,
  );

  const utm = buildUtmParams("new-videos");

  const items = rows
    .map((row) => {
      const artist = row.parsedArtist?.trim() || "Unknown Artist";
      const track = row.parsedTrack?.trim() || row.title?.trim() || "Untitled";
      const itemTitle = escapeXml(`${artist} — ${track}`);
      const link = `${SITE_ORIGIN}/s/${escapeXml(row.videoId)}?${utm}`;
      const pubDate = formatRfc822Date(row.createdAt);

      const descriptionParts: string[] = [];
      if (row.genre) {
        descriptionParts.push(`<p>Genre: ${escapeXml(row.genre)}</p>`);
      }
      if (row.thumbnail) {
        descriptionParts.push(
          `<p><img src="${escapeXml(row.thumbnail)}" alt="${escapeXml(artist + " — " + track)}" /></p>`,
        );
      }
      const description = descriptionParts.join("\n");

      return `    <item>
      <title>${itemTitle}</title>
      <link>${link}</link>
      <description><![CDATA[${description}]]></description>
      <pubDate>${pubDate}</pubDate>
      <guid isPermaLink="false">${escapeXml(row.videoId)}</guid>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>YehThatRocks — New Rock &amp; Metal Videos</title>
    <link>${SITE_ORIGIN}</link>
    <description>The latest rock and metal videos on YehThatRocks</description>
    <atom:link href="${SITE_ORIGIN}/feed/new-videos.xml" rel="self" type="application/rss+xml"/>
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
