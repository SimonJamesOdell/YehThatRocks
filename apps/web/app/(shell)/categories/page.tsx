import { CategoriesFilterGrid } from "@/components/categories-filter-grid";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import { getGenreCards } from "@/lib/catalog-data";

export default async function CategoriesPage() {
  const genreCards = await getGenreCards();

  return (
    <>
      <OverlayScrollReset />
      <CategoriesFilterGrid genreCards={genreCards} />
    </>
  );
}
