"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

import { CloseLink } from "@/components/close-link";
import type { GenreCard } from "@/lib/catalog-data";
import { getGenreSlug } from "@/lib/catalog-data";

type CategoriesFilterGridProps = {
  genreCards: GenreCard[];
};

export function CategoriesFilterGrid({ genreCards }: CategoriesFilterGridProps) {
  const [filterValue, setFilterValue] = useState("");

  const filteredCards = useMemo(() => {
    const needle = filterValue.trim().toLowerCase();
    if (!needle) {
      return genreCards;
    }

    return genreCards.filter(({ genre }) => genre.toLowerCase().startsWith(needle));
  }, [filterValue, genreCards]);

  return (
    <div className="categoriesFilterSection">
      <div className="favouritesBlindBar categoriesHeaderBar">
        <div className="categoriesHeaderMain">
          <strong>
            <span className="categoryHeaderBreadcrumb">☣ Categories</span>
          </strong>
          <div className="categoriesFilterBar">
            <input
              type="text"
              className="categoriesFilterInput"
              placeholder="type to filter..."
              value={filterValue}
              onChange={(event) => setFilterValue(event.target.value)}
              aria-label="Filter categories by prefix"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
        <CloseLink />
      </div>

      <div className="catalogGrid categoriesCatalogGrid">
        {filteredCards.length > 0 ? (
          filteredCards.map(({ genre, previewVideoId }) => (
            <Link
              key={genre}
              href={`/categories/${getGenreSlug(genre)}`}
              prefetch={false}
              className="catalogCard categoryCard linkedCard"
            >
              {previewVideoId ? (
                <div className="categoryThumbWrap">
                  <Image
                    src={`https://i.ytimg.com/vi/${previewVideoId}/mqdefault.jpg`}
                    alt=""
                    width={320}
                    height={180}
                    className="categoryThumb"
                    loading="lazy"
                  />
                </div>
              ) : null}
              <p className="statusLabel">Category</p>
              <h3>{genre}</h3>
            </Link>
          ))
        ) : (
          <article className="catalogCard categoriesFilterEmptyState">
            <p className="statusLabel">Category filter</p>
            <h3>No categories match that prefix</h3>
            <p>Try a shorter starting string.</p>
          </article>
        )}
      </div>
    </div>
  );
}
