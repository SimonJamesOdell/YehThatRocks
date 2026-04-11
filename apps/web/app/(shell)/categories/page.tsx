import { CategoriesFilterGrid } from "@/components/categories-filter-grid";
import { CategoriesScrollReset } from "@/components/categories-scroll-reset";
import { getGenreCards } from "@/lib/catalog-data";

export default async function CategoriesPage() {
  const genreCards = await getGenreCards();

  return (
    <>
      <CategoriesScrollReset />
      <CategoriesFilterGrid genreCards={genreCards} />
    </>
  );
}
