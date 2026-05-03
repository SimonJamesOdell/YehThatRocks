import type { Metadata } from "next";
import { CategoriesFilterGrid } from "@/components/categories-filter-grid";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import { getGenreCards } from "@/lib/catalog-data";

export const metadata: Metadata = {
  title: "Rock & Metal Genres | YehThatRocks",
  description: "Explore 153 rock and metal genres on YehThatRocks — from Classic Rock and Heavy Metal to Doom, Thrash, Prog, and beyond.",
  alternates: { canonical: "/categories" },
  openGraph: {
    title: "Rock & Metal Genres | YehThatRocks",
    description: "Explore 153 rock and metal genres on YehThatRocks.",
    url: "/categories",
    siteName: "YehThatRocks",
    type: "website",
  },
};

export default async function CategoriesPage() {
  const genreCards = await getGenreCards();

  return (
    <>
      <OverlayScrollReset />
      <CategoriesFilterGrid genreCards={genreCards} />
    </>
  );
}
