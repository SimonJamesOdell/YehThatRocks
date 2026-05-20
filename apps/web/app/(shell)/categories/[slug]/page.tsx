import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CategoryArtistsInfinite } from "@/components/category-artists-infinite";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import {
  getCategoryArtistsByGenre,
  getGenreBySlug,
} from "@/lib/catalog-data";

const CATEGORY_ARTISTS_FETCH_LIMIT = 2_000;

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://yehthatrocks.com";

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const genre = await getGenreBySlug(slug);
  if (!genre) return {};
  const title = `${genre} Artists | YehThatRocks`;
  const description = `Browse artists with videos in ${genre} on YehThatRocks, then drill into artist-specific category video lists.`;
  return {
    title,
    description,
    alternates: { canonical: `/categories/${slug}` },
    openGraph: {
      title,
      description,
      url: `/categories/${slug}`,
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

type CategoryPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function CategoryDetailPage({ params }: CategoryPageProps) {
  const { slug } = await params;
  const genre = await getGenreBySlug(slug);

  if (!genre) {
    notFound();
  }

  const allArtists = await getCategoryArtistsByGenre(genre, {
    offset: 0,
    limit: CATEGORY_ARTISTS_FETCH_LIMIT,
  });
  const categoryJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${genre} Artists | YehThatRocks`,
    description: `Browse artists with available ${genre} videos on YehThatRocks.`,
    url: `${SITE_ORIGIN}/categories/${slug}`,
    isPartOf: { "@type": "WebSite", name: "YehThatRocks", url: SITE_ORIGIN },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Genres", item: `${SITE_ORIGIN}/categories` },
        { "@type": "ListItem", position: 2, name: genre, item: `${SITE_ORIGIN}/categories/${slug}` },
      ],
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(categoryJsonLd) }} />
      <OverlayScrollReset />

      <CategoryArtistsInfinite
        slug={slug}
        genre={genre}
        allArtists={allArtists}
      />
    </>
  );
}


