"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { CloseLink } from "@/components/close-link";
import { OverlayHeader } from "@/components/overlay-header";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import { applyCategoryCardThumbnailPinOverrides } from "@/lib/category-cards-session-cache";
import { TOP_LEVEL_GENRE_BUCKETS } from "@/lib/genre-buckets";
import { THUMBNAIL_PIN_UPDATED_EVENT } from "@/lib/thumbnail-pin-client-sync";
import type { CategoriesNewTopLevelCard } from "@/lib/categories-new-snapshots";

type CategoriesNewGridProps = {
  cards: CategoriesNewTopLevelCard[];
  basePath?: "/categories" | "/categories_new";
};

function normalizeFilterToken(value: string) {
  return value.trim().toLowerCase();
}

export function CategoriesNewGrid({ cards, basePath = "/categories_new" }: CategoriesNewGridProps) {
  const router = useRouter();
  const pendingNavigationResetTimerRef = useRef<number | null>(null);
  const bucketTermMap = useMemo(() => new Map(
    TOP_LEVEL_GENRE_BUCKETS.map((bucket) => [bucket.label, bucket.terms]),
  ), []);
  const [resolvedCards, setResolvedCards] = useState(() => applyCategoryCardThumbnailPinOverrides(cards));
  const [filterValue, setFilterValue] = useState("");
  const [pendingNavigationSlug, setPendingNavigationSlug] = useState<string | null>(null);
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

  useEffect(() => {
    setResolvedCards(applyCategoryCardThumbnailPinOverrides(cards));
  }, [cards]);

  useEffect(() => {
    return () => {
      if (pendingNavigationResetTimerRef.current !== null) {
        window.clearTimeout(pendingNavigationResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleThumbnailPinUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{
        target?: "artist" | "category" | "category-artist";
        genre?: string;
        thumbnailVideoId?: string;
      }>;

      const detail = customEvent.detail;
      if (detail?.target !== "category" && detail?.target !== "category-artist") {
        return;
      }

      const normalizedGenre = detail.genre?.trim().toLowerCase();
      const normalizedVideoId = detail.thumbnailVideoId?.trim();
      if (!normalizedGenre || !normalizedVideoId) {
        return;
      }

      setResolvedCards((current) => current.map((card) => {
        if (card.genre.trim().toLowerCase() !== normalizedGenre) {
          return card;
        }

        if (card.previewVideoId === normalizedVideoId) {
          return card;
        }

        return {
          ...card,
          previewVideoId: normalizedVideoId,
        };
      }));
    };

    window.addEventListener(THUMBNAIL_PIN_UPDATED_EVENT, handleThumbnailPinUpdate as EventListener);
    return () => {
      window.removeEventListener(THUMBNAIL_PIN_UPDATED_EVENT, handleThumbnailPinUpdate as EventListener);
    };
  }, []);

  const cardsWithMatchState = useMemo(() => resolvedCards.map((card) => {
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
  }), [resolvedCards, bucketTermMap, filterTokens, normalizedFilterValue]);

  const filteredCards = useMemo(() => cardsWithMatchState, [cardsWithMatchState]);

  const allMatchesSingleCardGenre = useMemo(() => {
    if (normalizedFilterValue.length === 0) {
      return null;
    }

    const matchingCards = cardsWithMatchState.filter((card) => card.hasAnyMatch);
    if (matchingCards.length !== 1) {
      return null;
    }

    return matchingCards[0]?.slug ?? null;
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
              aria-label="Filter new category buckets"
              autoComplete="off"
              spellCheck={false}
              value={filterValue}
              onChange={(event) => setFilterValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !allMatchesSingleCardGenre) {
                  return;
                }

                event.preventDefault();
                router.push(`${basePath}/${allMatchesSingleCardGenre}`);
              }}
            />
          </div>
        </div>
        <CloseLink />
      </OverlayHeader>

      <div className="categoriesCatalogStage categoriesCatalogStageAuto">
        <div className="catalogGrid categoriesCatalogGrid categoriesCards categoriesCardsRevealed">
          {filteredCards.map((card, index) => {
            const topTerms = card.bucketTerms;
            const highlightWholeCard = allMatchesSingleCardGenre === card.slug;

            return (
              <Link
                key={card.slug}
                href={`${basePath}/${encodeURIComponent(card.slug)}`}
                className={[
                  "catalogCard",
                  "categoryCard",
                  "linkedCard",
                  "categoryCardCascade",
                  "categoryBucketCard",
                  highlightWholeCard ? "categoryBucketCardAllMatches" : "",
                ].filter(Boolean).join(" ")}
                style={{ "--category-cascade-index": index } as CSSProperties}
                prefetch={false}
                onMouseEnter={() => {
                  router.prefetch(`${basePath}/${encodeURIComponent(card.slug)}`);
                }}
                onFocus={() => {
                  router.prefetch(`${basePath}/${encodeURIComponent(card.slug)}`);
                }}
                onTouchStart={() => {
                  router.prefetch(`${basePath}/${encodeURIComponent(card.slug)}`);
                }}
                onClick={(event) => {
                  if (
                    event.defaultPrevented
                    || event.button !== 0
                    || event.metaKey
                    || event.ctrlKey
                    || event.shiftKey
                    || event.altKey
                  ) {
                    return;
                  }

                  setPendingNavigationSlug(card.slug);
                  router.prefetch(`${basePath}/${encodeURIComponent(card.slug)}`);

                  if (pendingNavigationResetTimerRef.current !== null) {
                    window.clearTimeout(pendingNavigationResetTimerRef.current);
                  }

                  pendingNavigationResetTimerRef.current = window.setTimeout(() => {
                    setPendingNavigationSlug((current) => (current === card.slug ? null : current));
                  }, 10000);
                }}
              >
                {card.previewVideoId ? (
                  <div className="categoryThumbWrap">
                    <YouTubeThumbnailImage
                      videoId={card.previewVideoId}
                      alt=""
                      className="categoryThumb"
                      format="mqdefault"
                      loading="lazy"
                      hideClosestSelector=".categoryBucketCard"
                      reportReason="categories-new-thumbnail-load-error"
                    />
                  </div>
                ) : null}
                <div className="categoryTitleRow">
                  <h3 className={card.titleMatches ? "categoryTitleMatch" : undefined}>{card.genre}</h3>
                  <p className="categoryArtistCount">{card.artistCount.toLocaleString("en-US")} {card.artistCount === 1 ? "artist" : "artists"}</p>
                </div>
                {topTerms.length > 0 ? (
                  <p className="categorySubcategories">
                    {topTerms.map((term, termIndex) => (
                      <span
                        key={`${card.genre}-${term}`}
                        className={card.matchedTermIndexes.has(termIndex) ? "categoryTermMatch" : undefined}
                      >
                        {term}
                        {termIndex < topTerms.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </p>
                ) : null}
              </Link>
            );
          })}
        </div>

        {pendingNavigationSlug ? (
          <div className="categoriesLoaderOverlay" role="status" aria-live="polite" aria-label="Opening category">
            <div className="playerBootLoader categoriesLoaderBootLoader">
              <div className="playerBootBars" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
              <p>Opening category...</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}