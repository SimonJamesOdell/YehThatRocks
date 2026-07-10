import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getVideosByDecade, getDecadeConfig, getAllDecadeSlugs, type SeoVideoItem } from "@/lib/programmatic-seo-data";
import { buildBreadcrumbList, buildCollectionPage } from "@/lib/schema-org";

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://yehthatrocks.com";

type DecadePageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return getAllDecadeSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: DecadePageProps): Promise<Metadata> {
  const { slug } = await params;
  const config = getDecadeConfig(slug);
  if (!config) return {};

  const title = `Best ${config.label} Rock & Metal Videos | YehThatRocks`;
  const description = `The best rock and metal music videos from the ${config.label}. Discover classic tracks from ${config.startYear}–${config.endYear} on YehThatRocks.`;

  return {
    title,
    description,
    alternates: { canonical: `/decade/${slug}` },
    openGraph: {
      title,
      description,
      url: `/decade/${slug}`,
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

function SeoVideoCard({ video }: { video: SeoVideoItem }) {
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

export default async function DecadePage({ params }: DecadePageProps) {
  const { slug } = await params;
  const config = getDecadeConfig(slug);
  if (!config) notFound();

  const data = await getVideosByDecade(slug, 50);

  const collectionJsonLd = buildCollectionPage({
    name: `Best ${config.label} Rock & Metal Videos | YehThatRocks`,
    url: `${SITE_ORIGIN}/decade/${slug}`,
    description: `The best rock and metal music videos from the ${config.label}. Discover classic tracks from ${config.startYear}–${config.endYear}.`,
    itemCount: data.totalCount,
  });

  const breadcrumbJsonLd = buildBreadcrumbList([
    { name: "Home", url: SITE_ORIGIN },
    { name: `${config.label} Rock & Metal`, url: `${SITE_ORIGIN}/decade/${slug}` },
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      <main className="seoLandingPage" role="main" aria-label={`Best ${config.label} rock and metal videos`}>
        <header className="seoLandingHeader">
          <h1>Best {config.label} Rock &amp; Metal Videos</h1>
          <p className="seoLandingSubtitle">
            {data.totalCount > 0
              ? `${data.totalCount} community-curated rock and metal music videos from the ${config.label} (${config.startYear}–${config.endYear}).`
              : `Browse rock and metal music videos from the ${config.label}.`}
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
            <p>No videos found for the {config.label} yet.</p>
            <p>
              <Link href="/new">Browse newest additions →</Link>
            </p>
          </div>
        )}

        <footer className="seoLandingFooter">
          <nav aria-label="Other decades">
            <h2>More decades</h2>
            <ul>
              {getAllDecadeSlugs()
                .filter((s) => s !== slug)
                .map((s) => {
                  const c = getDecadeConfig(s);
                  return c ? (
                    <li key={s}>
                      <Link href={`/decade/${s}`}>{c.label} Rock &amp; Metal</Link>
                    </li>
                  ) : null;
                })}
              <li><Link href="/top100">Top 100 most-played</Link></li>
            </ul>
          </nav>
        </footer>
      </main>
    </>
  );
}
