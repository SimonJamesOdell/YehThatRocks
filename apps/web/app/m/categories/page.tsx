import Link from "next/link";
import { getCategoriesNewTopLevelSnapshot } from "@/lib/categories-new-snapshots";

export default async function MobileCategoriesPage() {
  const snapshot = await getCategoriesNewTopLevelSnapshot();
  const rawCards = snapshot?.cards ?? [];
  const cards = rawCards
    .filter((card) => card.genre?.trim() !== "Rock / Metal")
    .slice(0, 8);

  return (
    <div>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">Categories</h1>
        <p className="mobile-page-subtitle">Browse by genre</p>
      </div>

      {cards.length === 0 ? (
        <div className="mobile-empty-state">
          <p>No categories available.</p>
        </div>
      ) : (
        <div className="mobile-categories-grid mobile-categories-grid--with-thumbs">
          {cards.map((card) => (
            <Link
              key={card.slug}
              href={`/m/categories/${card.slug}`}
              className="mobile-category-card mobile-category-card--with-thumb"
            >
              {card.previewVideoId ? (
                <img
                  src={`https://i.ytimg.com/vi/${encodeURIComponent(card.previewVideoId)}/mqdefault.jpg`}
                  alt={card.genre}
                  className="mobile-category-card-thumb"
                  loading="lazy"
                />
              ) : (
                <div className="mobile-category-card-thumb mobile-category-card-thumb--placeholder" />
              )}
              <div className="mobile-category-card-body">
                <span className="mobile-category-card-label">{card.genre}</span>
                <span className="mobile-category-card-count">
                  {card.artistCount.toLocaleString()} artist{card.artistCount !== 1 ? "s" : ""}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
