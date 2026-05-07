import type { Metadata } from "next";
import { CategoriesFilterGrid } from "@/components/categories-filter-grid";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import { getGenreCards } from "@/lib/catalog-data";

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://yehthatrocks.com";

export const metadata: Metadata = {
  title: "Rock & Metal Genres | YehThatRocks",
  description: "Explore 153 rock and metal genres on YehThatRocks — from Classic Rock and Heavy Metal to Doom, Thrash, Prog, and beyond.",
  alternates: { canonical: "/categories" },
  openGraph: {
    title: "Rock & Metal Genres | YehThatRocks",
    description: "Explore 153 rock and metal genres on YehThatRocks — from Classic Rock and Heavy Metal to Doom, Thrash, Prog, and beyond.",
    url: "/categories",
    siteName: "YehThatRocks",
    type: "website",
    images: [{ url: `${SITE_ORIGIN}/images/guitar_back.png`, alt: "YehThatRocks rock and metal genres" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Rock & Metal Genres | YehThatRocks",
    description: "Explore 153 rock and metal genres on YehThatRocks.",
    images: [`${SITE_ORIGIN}/images/guitar_back.png`],
  },
};

export default async function CategoriesPage() {
  const genreCards = await getGenreCards();

  const categoriesJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Rock & Metal Genres on YehThatRocks",
    description: "153 rock and metal genre categories with curated music videos.",
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
