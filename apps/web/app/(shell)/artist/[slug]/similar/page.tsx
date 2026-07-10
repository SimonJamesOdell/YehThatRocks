import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getArtistBySlug } from "@/lib/catalog-data";
import { getSimilarArtists } from "@/lib/programmatic-seo-data";
import { buildBreadcrumbList } from "@/lib/schema-org";

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://yehthatrocks.com";

type SimilarArtistsPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: SimilarArtistsPageProps): Promise<Metadata> {
  const { slug } = await params;
  const artist = await getArtistBySlug(slug);
  if (!artist) return {};

  const title = `Bands Like ${artist.name} — Similar Artists | YehThatRocks`;
  const description = `Discover artists similar to ${artist.name}. If you like ${artist.name}, check out these ${artist.genre || "rock and metal"} bands curated by the YehThatRocks community.`;

  return {
    title,
    description,
    alternates: { canonical: `/artist/${slug}/similar` },
    openGraph: {
      title,
      description,
      url: `/artist/${slug}/similar`,
      siteName: "YehThatRocks",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function SimilarArtistsPage({ params }: SimilarArtistsPageProps) {
  const { slug } = await params;
  const artist = await getArtistBySlug(slug);
  if (!artist) notFound();

  const similar = await getSimilarArtists(artist.name, artist.genre || "Rock / Metal", 24);

  const breadcrumbJsonLd = buildBreadcrumbList([
    { name: "Home", url: SITE_ORIGIN },
    { name: artist.name, url: `${SITE_ORIGIN}/artist/${encodeURIComponent(slug)}` },
    { name: "Similar Artists", url: `${SITE_ORIGIN}/artist/${encodeURIComponent(slug)}/similar` },
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      <main className="seoLandingPage" role="main" aria-label={`Artists similar to ${artist.name}`}>
        <header className="seoLandingHeader">
          <h1>Bands Like {artist.name}</h1>
          <p className="seoLandingSubtitle">
            If you like {artist.name}, you might also enjoy these{" "}
            {artist.genre || "rock and metal"} artists.
            {similar.length > 0
              ? ` ${similar.length} similar artists found.`
              : ""}
          </p>
        </header>

        {similar.length > 0 ? (
          <div className="seoArtistGrid">
            {similar.map((a) => (
              <article key={a.slug} className="seoArtistCard">
                <Link href={`/artist/${encodeURIComponent(a.slug)}`} className="seoArtistCardLink">
                  <div className="seoArtistCardContent">
                    <strong className="seoArtistCardName">{a.name}</strong>
                    <span className="seoArtistCardGenre">{a.genre}</span>
                    <span className="seoArtistCardCount">{a.videoCount} videos</span>
                  </div>
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="seoEmptyState">
            <p>No similar artists found for {artist.name} yet.</p>
            <p>
              <Link href={`/artist/${encodeURIComponent(slug)}`}>
                Back to {artist.name} videos →
              </Link>
            </p>
          </div>
        )}

        <footer className="seoLandingFooter">
          <nav aria-label="Related">
            <h2>More from {artist.name}</h2>
            <ul>
              <li>
                <Link href={`/artist/${encodeURIComponent(slug)}`}>
                  {artist.name} music videos
                </Link>
              </li>
              <li>
                <Link href={`/artist/${encodeURIComponent(slug)}/wiki`}>
                  {artist.name} artist wiki
                </Link>
              </li>
              <li>
                <Link href="/artists">Browse all artists</Link>
              </li>
            </ul>
          </nav>
        </footer>
      </main>
    </>
  );
}
