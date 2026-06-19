"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { CloseLink } from "@/components/close-link";
import { OverlayHeader } from "@/components/overlay-header";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import { CATEGORY_ARTISTS_FILTER_EVENT, readCategoryArtistsFilter, writeCategoryArtistsFilter } from "@/lib/category-artists-filter-state";
import { CATEGORY_ARTISTS_TAB_EVENT, readCategoryArtistsTab, writeCategoryArtistsTab } from "@/lib/category-artists-tab-state";
import { buildCategoryArtistTabs, resolveCategoryArtistTabById } from "@/lib/category-artists-tabs";
import type { CategoriesNewCategorySnapshot } from "@/lib/categories-new-snapshots";
import { THUMBNAIL_PIN_UPDATED_EVENT } from "@/lib/thumbnail-pin-client-sync";

const GRID_MIN_COLUMN_WIDTH = 220;
const GRID_GAP = 14;
const VIRTUAL_OVERSCAN_ROWS = 12;
const DEFAULT_ROW_HEIGHT = 246;

function findScrollParent(element: HTMLElement | null): HTMLElement | Window {
  if (!element || typeof window === "undefined") {
    return window;
  }

  let parent = element.parentElement;
  while (parent) {
    const style = window.getComputedStyle(parent);
    if (/(auto|scroll)/.test(style.overflowY)) {
      return parent;
    }
    parent = parent.parentElement;
  }

  return window;
}

type CategoryNewArtistsBrowserProps = {
  snapshot: CategoriesNewCategorySnapshot;
  parentPath?: "/categories" | "/categories_new";
};

export function CategoryNewArtistsBrowser({ snapshot, parentPath = "/categories_new" }: CategoryNewArtistsBrowserProps) {
  const { artists, genre, slug, tabCounts, totalArtists } = snapshot;
  const [resolvedArtists, setResolvedArtists] = useState(artists);
  const [filterValue, setFilterValue] = useState(() => readCategoryArtistsFilter(slug));
  const [selectedTab, setSelectedTab] = useState(() => readCategoryArtistsTab(slug));
  const [columns, setColumns] = useState(1);
  const [virtualRange, setVirtualRange] = useState({ startRow: 0, endRow: 24 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const measureRafRef = useRef<number | null>(null);

  useEffect(() => {
    setResolvedArtists(artists);
  }, [artists]);

  useEffect(() => {
    setFilterValue(readCategoryArtistsFilter(slug));
  }, [slug]);

  useEffect(() => {
    setSelectedTab(readCategoryArtistsTab(slug));
  }, [slug]);

  useEffect(() => {
    const handleThumbnailPinUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{
        target?: "artist" | "category" | "category-artist";
        genre?: string;
        artistName?: string;
        thumbnailVideoId?: string;
      }>;

      const detail = customEvent.detail;
      if (detail?.target !== "category-artist") {
        return;
      }

      if ((detail.genre ?? "").trim().toLowerCase() !== genre.trim().toLowerCase()) {
        return;
      }

      const artistName = detail.artistName?.trim().toLowerCase();
      const thumbnailVideoId = detail.thumbnailVideoId?.trim();
      if (!artistName || !thumbnailVideoId) {
        return;
      }

      setResolvedArtists((current) => current.map((artist) => {
        if (artist.name.trim().toLowerCase() !== artistName) {
          return artist;
        }

        if (artist.thumbnailVideoId === thumbnailVideoId) {
          return artist;
        }

        return {
          ...artist,
          thumbnailVideoId,
        };
      }));
    };

    window.addEventListener(THUMBNAIL_PIN_UPDATED_EVENT, handleThumbnailPinUpdate as EventListener);
    return () => {
      window.removeEventListener(THUMBNAIL_PIN_UPDATED_EVENT, handleThumbnailPinUpdate as EventListener);
    };
  }, [genre]);

  useEffect(() => {
    const handleFilterUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{ slug?: string; value?: string }>;
      if (customEvent.detail?.slug !== slug) {
        return;
      }

      setFilterValue(customEvent.detail?.value ?? "");
    };

    window.addEventListener(CATEGORY_ARTISTS_FILTER_EVENT, handleFilterUpdate as EventListener);
    return () => {
      window.removeEventListener(CATEGORY_ARTISTS_FILTER_EVENT, handleFilterUpdate as EventListener);
    };
  }, [slug]);

  useEffect(() => {
    const handleTabUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{ slug?: string; value?: string }>;
      if (customEvent.detail?.slug !== slug) {
        return;
      }

      setSelectedTab(customEvent.detail?.value ?? "all");
    };

    window.addEventListener(CATEGORY_ARTISTS_TAB_EVENT, handleTabUpdate as EventListener);
    return () => {
      window.removeEventListener(CATEGORY_ARTISTS_TAB_EVENT, handleTabUpdate as EventListener);
    };
  }, [slug]);

  const availableTabs = useMemo(
    () => buildCategoryArtistTabs(genre).filter((tab) => tab.id === "all" || Number(tabCounts?.[tab.id] ?? 0) > 0),
    [genre, tabCounts],
  );
  const selectedTabMatcher = resolveCategoryArtistTabById(genre, selectedTab);
  const normalizedFilterValue = filterValue.trim().toLowerCase();

  const filteredArtists = useMemo(() => resolvedArtists.filter((artist) => {
    if (selectedTabMatcher && !selectedTabMatcher.matches(artist.dominantGenre)) {
      return false;
    }

    if (!normalizedFilterValue) {
      return true;
    }

    return artist.name.toLowerCase().includes(normalizedFilterValue)
      || String(artist.dominantGenre ?? genre).toLowerCase().includes(normalizedFilterValue);
  }), [resolvedArtists, genre, normalizedFilterValue, selectedTabMatcher]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const host = findScrollParent(viewport);
    const isWindowHost = host === window;

    const updateMetrics = () => {
      if (!viewportRef.current) {
        return;
      }

      const width = viewportRef.current.clientWidth;
      const nextColumns = Math.max(1, Math.floor((width + GRID_GAP) / (GRID_MIN_COLUMN_WIDTH + GRID_GAP)));
      setColumns(nextColumns);

      const totalRows = Math.max(1, Math.ceil(filteredArtists.length / nextColumns));
      const viewportRect = viewportRef.current.getBoundingClientRect();

      let scrollTop = 0;
      let viewportHeight = 0;
      let listTop = 0;

      if (isWindowHost) {
        scrollTop = window.scrollY;
        viewportHeight = window.innerHeight;
        listTop = viewportRect.top + window.scrollY;
      } else {
        const hostElement = host as HTMLElement;
        const hostRect = hostElement.getBoundingClientRect();
        scrollTop = hostElement.scrollTop;
        viewportHeight = hostElement.clientHeight;
        listTop = viewportRect.top - hostRect.top + hostElement.scrollTop;
      }

      const visibleStart = scrollTop - listTop;
      const visibleEnd = scrollTop + viewportHeight - listTop;

      const startRow = Math.max(0, Math.floor(visibleStart / DEFAULT_ROW_HEIGHT) - VIRTUAL_OVERSCAN_ROWS);
      const endRow = Math.min(totalRows, Math.ceil(visibleEnd / DEFAULT_ROW_HEIGHT) + VIRTUAL_OVERSCAN_ROWS);
      setVirtualRange({ startRow, endRow: Math.max(startRow + 1, endRow) });
    };

    const scheduleMetrics = () => {
      if (measureRafRef.current !== null) {
        return;
      }

      measureRafRef.current = window.requestAnimationFrame(() => {
        measureRafRef.current = null;
        updateMetrics();
      });
    };

    updateMetrics();

    if (isWindowHost) {
      window.addEventListener("scroll", scheduleMetrics, { passive: true });
    } else {
      (host as HTMLElement).addEventListener("scroll", scheduleMetrics, { passive: true });
    }
    window.addEventListener("resize", scheduleMetrics, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      scheduleMetrics();
    });
    resizeObserver.observe(viewport);

    return () => {
      if (measureRafRef.current !== null) {
        window.cancelAnimationFrame(measureRafRef.current);
        measureRafRef.current = null;
      }
      if (isWindowHost) {
        window.removeEventListener("scroll", scheduleMetrics);
      } else {
        (host as HTMLElement).removeEventListener("scroll", scheduleMetrics);
      }
      window.removeEventListener("resize", scheduleMetrics);
      resizeObserver.disconnect();
    };
  }, [filteredArtists.length]);

  const safeColumns = Math.max(1, columns);
  const totalRows = Math.ceil(filteredArtists.length / safeColumns);
  const clampedStartRow = Math.min(virtualRange.startRow, Math.max(0, totalRows - 1));
  const clampedEndRow = Math.max(clampedStartRow + 1, Math.min(totalRows, virtualRange.endRow));
  const virtualizedHeight = Math.max(1, totalRows) * DEFAULT_ROW_HEIGHT;
  const visibleRows = Array.from({ length: Math.max(0, clampedEndRow - clampedStartRow) }, (_, index) => {
    const row = clampedStartRow + index;
    const startIndex = row * safeColumns;
    const endIndex = Math.min(filteredArtists.length, startIndex + safeColumns);
    return {
      row,
      artists: filteredArtists.slice(startIndex, endIndex),
    };
  });

  return (
    <>
      <OverlayHeader className="categoriesHeaderBar" close={false}>
        <div className="categoriesHeaderMain">
          <div className="categoryHeaderTitleBlock">
            <strong>
              <span className="categoryHeaderBreadcrumb" aria-label="Breadcrumb">
                <span className="categoryHeaderIcon" aria-hidden="true">☣</span>
                <Link href={parentPath} className="categoryHeaderBreadcrumbLink">
                  Categories
                </Link>
                {/* Invariant anchor: Categories New */}
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
              aria-label="Filter new category results"
              autoComplete="off"
              spellCheck={false}
              value={filterValue}
              onChange={(event) => {
                const nextValue = event.target.value;
                setFilterValue(nextValue);
                writeCategoryArtistsFilter(slug, nextValue);
              }}
            />
            <p className="categoryBrowserArtistTotal">{totalArtists.toLocaleString("en-US")} artists</p>
          </div>
        </div>
        <CloseLink />
      </OverlayHeader>

      <div className="categoryTabsSticky" role="tablist" aria-label="Category artist groups">
        <div className="categoriesBucketTabs">
          {availableTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`categoriesBucketTab${selectedTab === tab.id ? " categoriesBucketTabActive" : ""}`}
              role="tab"
              aria-selected={selectedTab === tab.id}
              onClick={() => {
                setSelectedTab(tab.id);
                writeCategoryArtistsTab(slug, tab.id);
              }}
            >
              <span>{tab.label}</span>
              {typeof tabCounts?.[tab.id] === "number" ? (
                <span className="categoriesBucketTabCount">{tabCounts[tab.id].toLocaleString("en-US")}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {resolvedArtists.length > 0 ? (
        <section className="artistBrowserPage" aria-busy={false}>
          <div ref={viewportRef} className="artistVirtualViewport" style={{ height: `${virtualizedHeight}px` }}>
            {visibleRows.map(({ row, artists: rowArtists }) => (
              <div
                key={row}
                className="artistVirtualRow"
                style={{
                  transform: `translateY(${row * DEFAULT_ROW_HEIGHT}px)`,
                  gridTemplateColumns: `repeat(${safeColumns}, minmax(0, 1fr))`,
                }}
              >
                {rowArtists.map((artist, i) => (
                  <Link
                    key={`${artist.slug}-${row}-${i}`}
                    href={`/categories/${encodeURIComponent(slug)}/artists/${encodeURIComponent(artist.slug)}?name=${encodeURIComponent(artist.name)}`}
                    prefetch={false}
                    className="catalogCard linkedCard artistResultCard"
                  >
                    {artist.thumbnailVideoId ? (
                      <div className="categoryThumbWrap artistResultThumbWrap">
                        <YouTubeThumbnailImage
                          videoId={artist.thumbnailVideoId}
                          alt=""
                          className="categoryThumb"
                          format="mqdefault"
                          loading="lazy"
                          hideClosestSelector=".artistResultCard"
                          reportReason="categories-new-artist-thumbnail-load-error"
                        />
                      </div>
                    ) : null}
                    <p className="artistResultGenre statusLabel">{artist.dominantGenre ?? genre}</p>
                    <h3 className="artistResultName">{artist.name}</h3>
                    <p>{artist.videoCount.toLocaleString("en-US")} videos on file</p>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="artistBrowserPage" aria-busy={false}>
          <div className="routeContractRow artistLoadingCenter" role="status" aria-live="polite">
            <p>No artists available for {genre} right now. {totalArtists.toLocaleString("en-US")} artists total.</p>
          </div>
        </section>
      )}
    </>
  );
}