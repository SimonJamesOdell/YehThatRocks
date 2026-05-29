import type { Metadata } from "next";

import { CategoryNewArtistsBrowser } from "@/components/category-new-artists-browser";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import { getCategoriesNewCategorySnapshot } from "@/lib/categories-new-snapshots";

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://yehthatrocks.com";

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const snapshot = await getCategoriesNewCategorySnapshot(slug);
  if (!snapshot) return {};
  const title = `${snapshot.genre} Artists | YehThatRocks`;
  const description = `Browse precomputed artists and counts for ${snapshot.genre} on YehThatRocks.`;
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
  const snapshot = await getCategoriesNewCategorySnapshot(slug);

  if (!snapshot) {
    return (
      <>
        <OverlayScrollReset />
        <article className="catalogCard categoryNoVideos">
          <p className="statusLabel">Categories</p>
          <h3>Snapshot not available</h3>
          <p>This category snapshot has not been built yet. Trigger a catalog change to publish one.</p>
        </article>
      </>
    );
  }

  const { genre } = snapshot;
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
      <CategoryNewArtistsBrowser snapshot={snapshot} parentPath="/categories" />
    </>
  );
}


