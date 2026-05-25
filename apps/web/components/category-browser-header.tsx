"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { CloseLink } from "@/components/close-link";
import { OverlayHeader } from "@/components/overlay-header";
import {
  CATEGORY_ARTISTS_CACHE_EVENT,
  readCategoryArtistsFirstPayloadFromSessionCache,
  readCategoryArtistsFullPayloadFromCache,
} from "@/lib/category-artists-session-cache";
import { readCategoryArtistsFilter, writeCategoryArtistsFilter } from "@/lib/category-artists-filter-state";

type CategoryBrowserHeaderProps = {
  genre: string;
  slug: string;
};

export function CategoryBrowserHeader({ genre, slug }: CategoryBrowserHeaderProps) {
  const [filterValue, setFilterValue] = useState("");
  const [totalArtists, setTotalArtists] = useState<number | null>(null);

  useEffect(() => {
    const headerElement = document.querySelector(".categoriesHeaderBar") as HTMLElement | null;
    const overlayContainer = headerElement?.closest(".overlayPanelInner") as HTMLElement | null;
    if (!headerElement || !overlayContainer) {
      return;
    }

    const updateHeaderHeight = () => {
      const nextHeight = Math.round(headerElement.getBoundingClientRect().height);
      overlayContainer.style.setProperty("--category-header-height", `${nextHeight}px`);
    };

    updateHeaderHeight();

    const resizeObserver = new ResizeObserver(() => {
      updateHeaderHeight();
    });
    resizeObserver.observe(headerElement);

    return () => {
      resizeObserver.disconnect();
      overlayContainer.style.removeProperty("--category-header-height");
    };
  }, [genre, slug, totalArtists]);

  useEffect(() => {
    setTotalArtists(readCategoryArtistsFirstPayloadFromSessionCache(slug)?.totalArtists ?? null);
  }, [slug]);

  useEffect(() => {
    setFilterValue(readCategoryArtistsFilter(slug));
  }, [slug]);

  useEffect(() => {
    const handleCacheUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{ slug?: string }>;
      if (customEvent.detail?.slug !== slug) {
        return;
      }

      const cachedTotal = readCategoryArtistsFullPayloadFromCache(slug)?.totalArtists
        ?? readCategoryArtistsFirstPayloadFromSessionCache(slug)?.totalArtists
        ?? null;
      setTotalArtists(cachedTotal);
    };

    window.addEventListener(CATEGORY_ARTISTS_CACHE_EVENT, handleCacheUpdate as EventListener);
    return () => {
      window.removeEventListener(CATEGORY_ARTISTS_CACHE_EVENT, handleCacheUpdate as EventListener);
    };
  }, [slug]);

  return (
    <OverlayHeader className="categoriesHeaderBar" close={false}>
      <div className="categoriesHeaderMain">
        <div className="categoryHeaderTitleBlock">
          <strong>
            <span className="categoryHeaderBreadcrumb" aria-label="Breadcrumb">
              <span className="categoryHeaderIcon" aria-hidden="true">☣</span>
              <Link href="/categories" className="categoryHeaderBreadcrumbLink">
                Categories
              </Link>
              <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
              <span className="categoryHeaderBreadcrumbCurrent" aria-current="page">{genre}</span>
            </span>
          </strong>
        </div>
        <div className="categoriesFilterBar">
          <input
            type="text"
            className="categoriesFilterInput"
            placeholder="type to filter..."
            aria-label="Filter category results"
            autoComplete="off"
            spellCheck={false}
            value={filterValue}
            onChange={(event) => {
              const nextValue = event.target.value;
              setFilterValue(nextValue);
              writeCategoryArtistsFilter(slug, nextValue);
            }}
          />
          {typeof totalArtists === "number" ? (
            <p className="categoryBrowserArtistTotal">{totalArtists.toLocaleString("en-US")} artists</p>
          ) : null}
        </div>
      </div>
      <CloseLink />
    </OverlayHeader>
  );
}