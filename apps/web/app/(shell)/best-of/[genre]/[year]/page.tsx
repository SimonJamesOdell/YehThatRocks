import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getVideosByGenreAndYear, type SeoVideoItem } from "@/lib/programmatic-seo-data";
import { buildBreadcrumbList, buildCollectionPage, buildOgImageUrl } from "@/lib/schema-org";

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://yehthatrocks.com";

type BestOfGenreYearProps = {
  params: Promise<{ genre: string; year: string }>;
};

export async function generateMetadata({ params }: BestOfGenreYearProps): Promise<Metadata> {
  const { genre, year: yearStr } = await params;
  const year = parseInt(yearStr, 10);
  if (!Number.isFinite(year) || year < 1960 || year > 2030) return {};

  const genreDisplay = genre
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const title = `Best ${genreDisplay} Songs of ${year} | YehThatRocks`;
  const description = `Discover the best ${genreDisplay.toLowerCase()} music videos from ${year}. Curated by community favourites on YehThatRocks.`;
  const ogImageUrl = buildOgImageUrl({ type: "genre", name: genreDisplay });

  return {
    title,
    description,
    alternates: { canonical: `/best-of/${genre}/${year}` },
    openGraph: {
      title,
      description,
      url: `/best-of/${genre}/${year}`,
      siteName: "YehThatRocks",
      type: "website",
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: `Best ${genreDisplay} of ${year}` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

function SeoVideoCard({ video }: { video: SeoVideoItem }) {
  const artistSlug = video.artist.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (
    <article className="seoVideoCard">
      <Link href={`/?v=${encodeURIComponent(video.id)}`} className="seoVideoCardLink">
        <img
          src={video.thumbnailUrl}
          alt={`${video.artist}${video.trackName ? ` — ${video.trackName}` : ""}`}
          className="seoVideoCardThumb"
          loading="lazy"
          width={480}
          height={360}
        />
        <div className="seoVideoCardMeta">
          <strong className="seoVideoCardTitle">{video.trackName || video.title}</strong>
          <span className="seoVideoCardArtist">{video.artist}</span>
          <span className="seoVideoCardGenre">{video.genre}</span>
        </div>
      </Link>
    </article>
  );
}

export default async function BestOfGenreYearPage({ params }: BestOfGenreYearProps) {
  const { genre, year: yearStr } = await params;
  const year = parseInt(yearStr, 10);

  if (!Number.isFinite(year) || year < 1960 || year > 2030) {
    notFound();
  }

  const genreDisplay = genre
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const data = await getVideosByGenreAndYear(genreDisplay, year, 50);

  const collectionJsonLd = buildCollectionPage({
    name: `Best ${genreDisplay} Songs of ${year} | YehThatRocks`,
    url: `${SITE_ORIGIN}/best-of/${genre}/${year}`,
    description: `Discover the best ${genreDisplay.toLowerCase()} music videos from ${year}. Curated by community favourites.`,
    itemCount: data.totalCount,
  });

  const breadcrumbJsonLd = buildBreadcrumbList([
    { name: "Home", url: SITE_ORIGIN },
    { name: `Best ${genreDisplay} of ${year}`, url: `${SITE_ORIGIN}/best-of/${genre}/${year}` },
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      <main className="seoLandingPage" role="main" aria-label={`Best ${genreDisplay} songs of ${year}`}>
        <header className="seoLandingHeader">
          <h1>Best {genreDisplay} Songs of {year}</h1>
          <p className="seoLandingSubtitle">
            {data.totalCount > 0
              ? `${data.totalCount} community-curated ${genreDisplay.toLowerCase()} music videos from ${year}.`
              : `Browse ${genreDisplay.toLowerCase()} music videos from ${year}.`}
          </p>
        </header>

        {data.videos.length > 0 ? (
          <div className="seoVideoGrid">
            {data.videos.map((video) => (
              <SeoVideoCard key={video.id} video={video} />
            ))}
          </div>
        ) : (
          <div className="seoEmptyState">
            <p>No {genreDisplay.toLowerCase()} videos found for {year} yet.</p>
            <p>
              <Link href="/new">Browse newest additions →</Link>
            </p>
          </div>
        )}

        <footer className="seoLandingFooter">
          <nav aria-label="Related searches">
            <h2>More rock & metal by year</h2>
            <ul>
              <li><Link href={`/decade/${Math.floor(year / 10)}0s`}>{Math.floor(year / 10)}0s rock & metal</Link></li>
              <li><Link href="/top100">Top 100 most-played</Link></li>
              <li><Link href="/new">New additions</Link></li>
            </ul>
          </nav>
        </footer>
      </main>
    </>
  );
}
