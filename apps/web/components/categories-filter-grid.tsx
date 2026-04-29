"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { CloseLink } from "@/components/close-link";
import type { GenreCard } from "@/lib/catalog-data";
import { getGenreSlug } from "@/lib/catalog-data";

type CategoriesFilterGridProps = {
  genreCards: GenreCard[];
};

export function CategoriesFilterGrid({ genreCards }: CategoriesFilterGridProps) {
  const [filterValue, setFilterValue] = useState("");
  const [cards, setCards] = useState<GenreCard[]>(genreCards);
  const [isLoadingCards, setIsLoadingCards] = useState(genreCards.length === 0);
  const [isLoaderVisible, setIsLoaderVisible] = useState(genreCards.length === 0);
  const [isLoaderFadingOut, setIsLoaderFadingOut] = useState(false);
  const [hasRevealedCards, setHasRevealedCards] = useState(genreCards.length > 0);
  const loaderFadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCards(genreCards);
    setIsLoadingCards(genreCards.length === 0);

    if (genreCards.length > 0) {
      setIsLoaderVisible(false);
      setIsLoaderFadingOut(false);
      setHasRevealedCards(true);
    }
  }, [genreCards]);

  useEffect(() => {
    return () => {
      if (loaderFadeTimeoutRef.current !== null) {
        clearTimeout(loaderFadeTimeoutRef.current);
      }
    };
  }, []);

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
      } finally {
        if (!cancelled) {
          setIsLoadingCards(false);
        }
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

  useEffect(() => {
    if (hasActiveFilter) {
      if (loaderFadeTimeoutRef.current !== null) {
        clearTimeout(loaderFadeTimeoutRef.current);
        loaderFadeTimeoutRef.current = null;
      }

      setIsLoaderVisible(false);
      setIsLoaderFadingOut(false);
      setHasRevealedCards(true);
      return;
    }

    if (isLoadingCards) {
      if (loaderFadeTimeoutRef.current !== null) {
        clearTimeout(loaderFadeTimeoutRef.current);
        loaderFadeTimeoutRef.current = null;
      }

      setIsLoaderVisible(true);
      setIsLoaderFadingOut(false);
      return;
    }

    if (filteredCards.length > 0) {
      if (isLoaderVisible) {
        setIsLoaderFadingOut(true);
        setHasRevealedCards(true);
        loaderFadeTimeoutRef.current = setTimeout(() => {
          setIsLoaderVisible(false);
          setIsLoaderFadingOut(false);
          loaderFadeTimeoutRef.current = null;
        }, 190);
      } else {
        setHasRevealedCards(true);
      }
      return;
    }

    setIsLoaderVisible(false);
    setIsLoaderFadingOut(false);
  }, [filteredCards.length, hasActiveFilter, isLoadingCards, isLoaderVisible]);

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

      <div className="categoriesCatalogStage">
        {filteredCards.length > 0 ? (
          <div className={`catalogGrid categoriesCatalogGrid categoriesCards${hasRevealedCards ? " categoriesCardsRevealed" : ""}`}>
            {filteredCards.map(({ genre, previewVideoId }, index) => (
              <Link
                key={genre}
                href={`/categories/${getGenreSlug(genre)}`}
                prefetch={false}
                className="catalogCard categoryCard linkedCard categoryCardCascade"
                style={{ "--category-cascade-index": index } as CSSProperties}
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
                      sizes="(max-width: 768px) 92vw, (max-width: 1200px) 44vw, 320px"
                    />
                  </div>
                ) : null}
                <p className="statusLabel">Category</p>
                <h3>{genre}</h3>
              </Link>
            ))}
          </div>
        ) : hasActiveFilter ? (
          <div className="catalogGrid categoriesCatalogGrid">
            <article className="catalogCard categoriesFilterEmptyState">
              <p className="statusLabel">Category filter</p>
              <h3>No categories match that prefix</h3>
              <p>Try a shorter starting string.</p>
            </article>
          </div>
        ) : null}

        {(isLoaderVisible || isLoaderFadingOut) && !hasActiveFilter ? (
          <div
            className={`categoriesLoaderOverlay${isLoaderFadingOut ? " categoriesLoaderOverlayFading" : ""}`}
            role="status"
            aria-live="polite"
            aria-label="Loading categories"
          >
            <div className="playerBootLoader categoriesLoaderBootLoader">
              <div className="playerBootBars" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
              <p>Loading categories...</p>
            </div>
          </div>
        ) : null}

        {!isLoadingCards && filteredCards.length === 0 && !hasActiveFilter ? (
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
