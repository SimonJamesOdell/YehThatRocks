import type { Metadata } from "next";
import { CategoriesFilterGrid } from "@/components/categories-filter-grid";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import { getGenreCards, getRuntimeCachedTopLevelGenreCards } from "@/lib/catalog-data";
import { TOP_LEVEL_GENRE_BUCKETS } from "@/lib/genre-buckets";
import type { GenreCard } from "@/lib/catalog-data-utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://yehthatrocks.com";

export const metadata: Metadata = {
  title: "Rock & Metal Category Buckets | YehThatRocks",
  description: "Explore top-level rock and metal category buckets on YehThatRocks — from Classic and Extreme Metal to Punk, Doom, Modern, and Progressive scenes.",
  alternates: { canonical: "/categories" },
  openGraph: {
    title: "Rock & Metal Category Buckets | YehThatRocks",
    description: "Explore top-level rock and metal category buckets on YehThatRocks.",
    url: "/categories",
    siteName: "YehThatRocks",
    type: "website",
    images: [{ url: `${SITE_ORIGIN}/images/guitar_back.png`, alt: "YehThatRocks rock and metal category buckets" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Rock & Metal Category Buckets | YehThatRocks",
    description: "Explore top-level rock and metal category buckets on YehThatRocks.",
    images: [`${SITE_ORIGIN}/images/guitar_back.png`],
  },
};

export default async function CategoriesPage() {
  const fallbackCards: GenreCard[] = TOP_LEVEL_GENRE_BUCKETS.map((bucket) => ({
    genre: bucket.label,
    previewVideoId: null,
    artistCount: 0,
  }));

  const genreCards = await getRuntimeCachedTopLevelGenreCards()
    .then(async (cards) => {
      if (cards && cards.some((card) => card.previewVideoId || Number(card.artistCount ?? 0) > 0)) {
        return cards;
      }

      const richer = await getGenreCards().catch(() => null);
      if (richer && richer.some((card) => card.previewVideoId || Number(card.artistCount ?? 0) > 0)) {
        return richer;
      }

      return fallbackCards;
    })
    .catch(() => fallbackCards);

  const categoriesJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Rock & Metal Category Buckets on YehThatRocks",
    description: "Top-level rock and metal category buckets with curated music videos.",
    url: `${SITE_ORIGIN}/categories`,
    itemListElement: genreCards.slice(0, 50).map((card, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: card.genre,
      url: `${SITE_ORIGIN}/categories/${card.genre.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(categoriesJsonLd) }} />
      <OverlayScrollReset />
      <CategoriesFilterGrid genreCards={genreCards} />
    </>
  );
}
