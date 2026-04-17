"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { CloseLink } from "@/components/close-link";
import type { GenreCard } from "@/lib/catalog-data";
import { getGenreSlug } from "@/lib/catalog-data";

type CategoriesFilterGridProps = {
  genreCards: GenreCard[];
};

export function CategoriesFilterGrid({ genreCards }: CategoriesFilterGridProps) {
  const [filterValue, setFilterValue] = useState("");
  const [cards, setCards] = useState<GenreCard[]>(genreCards);

  useEffect(() => {
    setCards(genreCards);
  }, [genreCards]);

  useEffect(() => {
    if (genreCards.length > 0) {
      return;
    }

    let cancelled = false;

    const loadCards = async () => {
      try {
        const response = await fetch("/api/categories", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as { categories?: GenreCard[] };
        const nextCards = Array.isArray(payload.categories) ? payload.categories : [];
        if (!cancelled && nextCards.length > 0) {
          setCards(nextCards);
        }
      } catch {
        // Keep server-provided cards when client fallback fetch fails.
      }
    };

    void loadCards();

    return () => {
      cancelled = true;
    };
  }, [genreCards]);

  const filteredCards = useMemo(() => {
    const needle = filterValue.trim().toLowerCase();
    if (!needle) {
      return cards;
    }

    return cards.filter(({ genre }) => genre.toLowerCase().startsWith(needle));
  }, [filterValue, cards]);

  const hasActiveFilter = filterValue.trim().length > 0;

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
          ) : hasActiveFilter ? (
          <article className="catalogCard categoriesFilterEmptyState">
            <p className="statusLabel">Category filter</p>
            <h3>No categories match that prefix</h3>
            <p>Try a shorter starting string.</p>
          </article>
          ) : (
            <article className="catalogCard categoriesFilterEmptyState">
              <p className="statusLabel">Category list</p>
              <h3>Loading categories...</h3>
              <p>Please wait a moment.</p>
            </article>
        )}
      </div>
    </div>
  );
}
