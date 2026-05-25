import type { Metadata } from "next";

import { CategoryArtistsBrowser } from "@/components/category-artists-browser";
import { CategoryBrowserHeader } from "@/components/category-browser-header";
import { CategoryBrowserTabs } from "@/components/category-browser-tabs";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import { getGenreBySlug } from "@/lib/catalog-data";

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
    return (
      <>
        <OverlayScrollReset />
        <article className="catalogCard categoryNoVideos">
          <p className="statusLabel">Categories</p>
          <h3>Category not found</h3>
          <p>This bucket is not available right now.</p>
        </article>
      </>
    );
  }
  const categoryJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${genre} | YehThatRocks`,
    description: `Browse ${genre} on YehThatRocks.`,
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
      <CategoryBrowserHeader genre={genre} slug={slug} />
      <CategoryBrowserTabs genre={genre} slug={slug} />
      <CategoryArtistsBrowser slug={slug} genre={genre} />
    </>
  );
}


