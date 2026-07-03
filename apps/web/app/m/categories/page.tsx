import Link from "next/link";
import { getGenreSlug } from "@/lib/catalog-data-utils";

type GenreCard = {
  genre: string;
  previewVideoId: string | null;
  artistCount: number;
};

async function getCategories(): Promise<GenreCard[]> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/categories`, { cache: "no-store" });
    const data = await res.json();
    return data.categories || [];
  } catch {
    return [];
  }
}

export default async function MobileCategoriesPage() {
  const categories = await getCategories();

  return (
    <div>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">Categories</h1>
        <p className="mobile-page-subtitle">Browse by genre</p>
      </div>

      {categories.length === 0 ? (
        <div className="mobile-empty-state">
          <p>No categories available.</p>
        </div>
      ) : (
        <div className="mobile-categories-grid">
          {categories.map((cat) => {
            const slug = getGenreSlug(cat.genre);
            return (
              <Link
                key={slug}
                href={`/m/categories/${slug}`}
                className="mobile-category-card"
              >
                {cat.genre}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
