"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { CloseLink } from "@/components/close-link";
import { OverlayHeader } from "@/components/overlay-header";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import { getGenreSlug } from "@/lib/catalog-data-utils";
import type { GenreCard } from "@/lib/catalog-data";

type CategoriesFilterGridProps = {
  genreCards: GenreCard[];
};

let lastKnownCategoriesWithArtists: GenreCard[] = [];

export function CategoriesFilterGrid({ genreCards }: CategoriesFilterGridProps) {
  const initialCardsNeedCountRefresh = useMemo(
    () => genreCards.length > 0 && genreCards.every((card) => Number(card.artistCount ?? 0) === 0),
    [genreCards],
  );
  const shouldDeferInitialCards = genreCards.length > 0 && initialCardsNeedCountRefresh;
  const initialCards = shouldDeferInitialCards
    ? (lastKnownCategoriesWithArtists.length > 0 ? lastKnownCategoriesWithArtists : [])
    : genreCards;
  const [filterValue, setFilterValue] = useState("");
  const [cards, setCards] = useState<GenreCard[]>(initialCards);
  const [isLoadingCards, setIsLoadingCards] = useState(genreCards.length === 0 || (shouldDeferInitialCards && initialCards.length === 0));
  const [isLoaderVisible, setIsLoaderVisible] = useState(genreCards.length === 0);
  const [isLoaderFadingOut, setIsLoaderFadingOut] = useState(false);
  const [hasRevealedCards, setHasRevealedCards] = useState(genreCards.length > 0);
  const loaderFadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCards((previous) => {
      if (!shouldDeferInitialCards) {
        return genreCards;
      }
      if (previous.length > 0) {
        return previous;
      }
      return lastKnownCategoriesWithArtists.length > 0 ? lastKnownCategoriesWithArtists : [];
    });
    setIsLoadingCards(genreCards.length === 0 || (shouldDeferInitialCards && lastKnownCategoriesWithArtists.length === 0));

    if (genreCards.length > 0 && !shouldDeferInitialCards) {
      setIsLoaderVisible(false);
      setIsLoaderFadingOut(false);
      setHasRevealedCards(true);
    }
  }, [genreCards, shouldDeferInitialCards]);

  useEffect(() => {
    return () => {
      if (loaderFadeTimeoutRef.current !== null) {
        clearTimeout(loaderFadeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (genreCards.length > 0 && !initialCardsNeedCountRefresh) {
      return;
    }

    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const RETRY_DELAYS_MS = [700, 1400, 2400];

    const scheduleRetry = (attempt: number, loadCards: (nextAttempt: number) => Promise<void>) => {
      if (attempt >= RETRY_DELAYS_MS.length) {
        setIsLoadingCards(false);
        return;
      }

      const retryDelay = RETRY_DELAYS_MS[attempt];
      retryTimeout = setTimeout(() => {
        void loadCards(attempt + 1);
      }, retryDelay);
    };

    const loadCards = async (attempt = 0) => {
      try {
        const response = await fetch("/api/categories", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("categories-fetch-failed");
        }

        const payload = (await response.json()) as { categories?: GenreCard[] };
        const nextCards = Array.isArray(payload.categories) ? payload.categories : [];

        if (cancelled) {
          return;
        }

        const hasVisibleCounts = nextCards.some((card) => Number(card.artistCount ?? 0) > 0);
        if (nextCards.length === 0 || !hasVisibleCounts) {
          if (lastKnownCategoriesWithArtists.length > 0) {
            setCards(lastKnownCategoriesWithArtists);
            setIsLoadingCards(false);
            return;
          }

          throw new Error("categories-payload-incomplete");
        }

        lastKnownCategoriesWithArtists = nextCards;
        setCards(nextCards);
        setIsLoadingCards(false);
      } catch {
        if (cancelled) {
          return;
        }

        scheduleRetry(attempt, loadCards);
      }
    };

    void loadCards();

    return () => {
      cancelled = true;

      if (retryTimeout !== null) {
        clearTimeout(retryTimeout);
      }
    };
  }, [genreCards, initialCardsNeedCountRefresh]);

  const categoriesWithArtists = useMemo(() => {
    return cards.filter((card) => Number(card.artistCount ?? 0) > 0);
  }, [cards]);

  const filteredCards = useMemo(() => {
    const needle = filterValue.trim().toLowerCase();
    if (!needle) {
      return categoriesWithArtists;
    }

    return categoriesWithArtists.filter(({ genre }) => genre.toLowerCase().startsWith(needle));
  }, [filterValue, categoriesWithArtists]);

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
      <OverlayHeader className="categoriesHeaderBar" close={false}>
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
      </OverlayHeader>

      <div className="categoriesCatalogStage">
        {filteredCards.length > 0 ? (
          <div className={`catalogGrid categoriesCatalogGrid categoriesCards${hasRevealedCards ? " categoriesCardsRevealed" : ""}`}>
            {filteredCards.map(({ genre, previewVideoId, artistCount }, index) => (
              <Link
                key={genre}
                href={`/categories/${getGenreSlug(genre)}`}
                prefetch={false}
                className="catalogCard categoryCard linkedCard categoryCardCascade"
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
                      hideClosestSelector=".categoryCard"
                      reportReason="category-thumbnail-load-error"
                    />
                  </div>
                ) : null}
                <p className="statusLabel">Category</p>
                <h3>{genre}</h3>
                <p className="categoryArtistCount">{artistCount.toLocaleString("en-US")} {artistCount === 1 ? "artist" : "artists"}</p>
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
