"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { CloseLink } from "@/components/close-link";
import { OverlayHeader } from "@/components/overlay-header";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import { getGenreSlug } from "@/lib/catalog-data-utils";
import { TOP_LEVEL_GENRE_BUCKETS } from "@/lib/genre-buckets";
import type { GenreCard } from "@/lib/catalog-data";

type CategoriesFilterGridProps = {
  genreCards: GenreCard[];
};

export function CategoriesFilterGrid({ genreCards }: CategoriesFilterGridProps) {
  const bucketTermMap = useMemo(() => new Map(
    TOP_LEVEL_GENRE_BUCKETS.map((bucket) => [bucket.label, bucket.terms]),
  ), []);
  const [cards, setCards] = useState<GenreCard[]>(genreCards);

  useEffect(() => {
    setCards(genreCards);
  }, [genreCards]);

  return (
    <div className="categoriesFilterSection">
      <OverlayHeader className="categoriesHeaderBar" close={false}>
        <div className="categoriesHeaderMain">
          <strong>
            <span className="categoryHeaderBreadcrumb">☣ Categories</span>
          </strong>
        </div>
        <CloseLink />
      </OverlayHeader>

      <div className="categoriesCatalogStage">
        {cards.length > 0 ? (
          <div className="catalogGrid categoriesCatalogGrid categoriesCards categoriesCardsRevealed">
            {cards.map(({ genre, previewVideoId, artistCount }, index) => (
              (() => {
                const bucketTerms = bucketTermMap.get(genre) ?? [];
                const topTerms = bucketTerms.slice(0, 8);

                return (
                  <Link
                    key={genre}
                    href={`/categories/${getGenreSlug(genre)}`}
                    prefetch={false}
                    className="categoryBucketCard"
                    style={{ "--category-cascade-index": index } as CSSProperties}
                  >
                    {previewVideoId ? (
                      <div className="categoryThumbWrap">
                        <YouTubeThumbnailImage
                          videoId={previewVideoId}
                          alt=""
                          className="categoryThumb"
                          format="mqdefault"
                          loading="lazy"
                          hideClosestSelector=".categoryBucketCard"
                          reportReason="category-thumbnail-load-error"
                        />
                      </div>
                    ) : null}
                    <div className="categoryTitleRow">
                      <h3>{genre}</h3>
                      <p className="categoryArtistCount">{artistCount.toLocaleString("en-US")} {artistCount === 1 ? "artist" : "artists"}</p>
                    </div>
                    {topTerms.length > 0 ? (
                      <p className="categorySubcategories">
                        {topTerms.join(", ")}
                      </p>
                    ) : null}
                  </Link>
                );
              })()
            ))}
          </div>
        ) : null}

        {cards.length === 0 ? (
          <div className="catalogGrid categoriesCatalogGrid">
            <article className="catalogCard categoriesFilterEmptyState">
              <p className="statusLabel">Category list</p>
              <h3>No categories available right now</h3>
              <p>Please try again in a moment.</p>
            </article>
          </div>
        ) : null}
      </div>
    </div>
  );
}
