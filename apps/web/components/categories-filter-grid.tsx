"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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

function normalizeFilterToken(value: string) {
  return value.trim().toLowerCase();
}

export function CategoriesFilterGrid({ genreCards }: CategoriesFilterGridProps) {
  const router = useRouter();
  const bucketTermMap = useMemo(() => new Map(
    TOP_LEVEL_GENRE_BUCKETS.map((bucket) => [bucket.label, bucket.terms]),
  ), []);
  const [cards, setCards] = useState<GenreCard[]>(genreCards);
  const [filterValue, setFilterValue] = useState("");

  useEffect(() => {
    setCards(genreCards);
  }, [genreCards]);

  const normalizedFilterValue = useMemo(
    () => normalizeFilterToken(filterValue),
    [filterValue],
  );

  const filterTokens = useMemo(
    () => normalizedFilterValue
      .split(/[\s,]+/)
      .map((token) => normalizeFilterToken(token))
      .filter(Boolean),
    [normalizedFilterValue],
  );

  const cardsWithMatchState = useMemo(() => cards.map((card) => {
    const bucketTerms = bucketTermMap.get(card.genre) ?? [];
    const normalizedGenre = normalizeFilterToken(card.genre);
    const titleMatches = normalizedFilterValue.length > 0 && normalizedGenre.startsWith(normalizedFilterValue);
    const matchedTermIndexes = new Set<number>();
    const matchedTokens = new Set<string>();

    for (const token of filterTokens) {
      if (normalizedGenre.startsWith(token)) {
        matchedTokens.add(token);
      }

      bucketTerms.forEach((term, index) => {
        if (normalizeFilterToken(term).startsWith(token)) {
          matchedTermIndexes.add(index);
          matchedTokens.add(token);
        }
      });
    }

    const hasAnyMatch = normalizedFilterValue.length === 0 || titleMatches || matchedTokens.size > 0;
    const hasAllMatches = filterTokens.length > 0 && filterTokens.every((token) => matchedTokens.has(token));

    return {
      ...card,
      bucketTerms,
      matchedTermIndexes,
      hasAnyMatch,
      hasAllMatches,
      titleMatches,
    };
  }), [cards, bucketTermMap, filterTokens, normalizedFilterValue]);

  const allMatchesSingleCardGenre = useMemo(() => {
    if (normalizedFilterValue.length === 0) {
      return null;
    }

    const matchingCards = cardsWithMatchState.filter((card) => card.hasAnyMatch);
    if (matchingCards.length !== 1) {
      return null;
    }

    return matchingCards[0]?.genre ?? null;
  }, [cardsWithMatchState, normalizedFilterValue.length]);

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
              aria-label="Filter category buckets"
              autoComplete="off"
              spellCheck={false}
              value={filterValue}
              onChange={(event) => setFilterValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }

                if (!allMatchesSingleCardGenre) {
                  return;
                }

                event.preventDefault();
                router.push(`/categories/${getGenreSlug(allMatchesSingleCardGenre)}`);
              }}
            />
          </div>
        </div>
        <CloseLink />
      </OverlayHeader>

      <div className="categoriesCatalogStage">
        {cardsWithMatchState.length > 0 ? (
          <div className="catalogGrid categoriesCatalogGrid categoriesCards categoriesCardsRevealed">
            {cardsWithMatchState.map(({ genre, previewVideoId, artistCount, bucketTerms, matchedTermIndexes, titleMatches }, index) => (
              (() => {
                const topTerms = bucketTerms;
                const highlightWholeCard = allMatchesSingleCardGenre === genre;

                return (
                  <Link
                    key={genre}
                    href={`/categories/${getGenreSlug(genre)}`}
                    prefetch={false}
                    className={[
                      "categoryBucketCard",
                      highlightWholeCard ? "categoryBucketCardAllMatches" : "",
                    ].filter(Boolean).join(" ")}
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
                      <h3 className={titleMatches ? "categoryTitleMatch" : undefined}>{genre}</h3>
                      <p className="categoryArtistCount">{artistCount.toLocaleString("en-US")} {artistCount === 1 ? "artist" : "artists"}</p>
                    </div>
                    {topTerms.length > 0 ? (
                      <p className="categorySubcategories">
                        {topTerms.map((term, termIndex) => (
                          <span
                            key={`${genre}-${term}`}
                            className={matchedTermIndexes.has(termIndex) ? "categoryTermMatch" : undefined}
                          >
                            {term}
                            {termIndex < topTerms.length - 1 ? ", " : ""}
                          </span>
                        ))}
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
