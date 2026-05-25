"use client";

import Link from "next/link";
import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import {
  CATEGORY_ARTISTS_CACHE_EVENT,
  type CategoryArtistsFirstPayload,
  prefetchCategoryArtistsFirstPayload,
  primeCategoryArtistsFullPayload,
  readCategoryArtistsFirstPayloadFromSessionCache,
  readCategoryArtistsFullPayloadFromCache,
} from "@/lib/category-artists-session-cache";
import { CATEGORY_ARTISTS_FILTER_EVENT, readCategoryArtistsFilter } from "@/lib/category-artists-filter-state";
import { CATEGORY_ARTISTS_TAB_EVENT, readCategoryArtistsTab } from "@/lib/category-artists-tab-state";
import { resolveCategoryArtistTabById } from "@/lib/category-artists-tabs";
import type { CategoryArtistCard } from "@/lib/catalog-data";

type CategoryArtistsBrowserProps = {
  slug: string;
  genre: string;
};

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
    const overflowY = style.overflowY;
    const canScroll = /(auto|scroll)/.test(overflowY);
    if (canScroll) {
      return parent;
    }

    parent = parent.parentElement;
  }

  return window;
}

export function CategoryArtistsBrowser({ slug, genre }: CategoryArtistsBrowserProps) {
  const initialFullPayload = useMemo(
    () => (typeof window === "undefined" ? null : readCategoryArtistsFullPayloadFromCache(slug)),
    [slug],
  );
  const initialFirstPayload = useMemo(
    () => (
      typeof window === "undefined"
        ? null
        : readCategoryArtistsFirstPayloadFromSessionCache(slug)
    ),
    [slug],
  );
  const [artists, setArtists] = useState<CategoryArtistCard[]>(
    initialFullPayload?.artists ?? initialFirstPayload?.artists ?? [],
  );
  const [totalArtists, setTotalArtists] = useState<number | null>(
    initialFullPayload?.totalArtists ?? initialFirstPayload?.totalArtists ?? null,
  );
  const [isLoading, setIsLoading] = useState(artists.length === 0);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const measureRafRef = useRef<number | null>(null);
  const appendQueueRef = useRef<CategoryArtistCard[]>([]);
  const appendFlushFrameRef = useRef<number | null>(null);
  const [filterValue, setFilterValue] = useState(() => readCategoryArtistsFilter(slug));
  const [selectedTab, setSelectedTab] = useState(() => readCategoryArtistsTab(slug));
  const [columns, setColumns] = useState(1);
  const [virtualRange, setVirtualRange] = useState({ startRow: 0, endRow: 24 });

  function appendArtists(incoming: CategoryArtistCard[]) {
    if (incoming.length === 0) {
      return;
    }

    appendQueueRef.current.push(...incoming);
    if (appendFlushFrameRef.current !== null) {
      return;
    }

    appendFlushFrameRef.current = window.requestAnimationFrame(() => {
      appendFlushFrameRef.current = null;
      const queued = appendQueueRef.current;
      appendQueueRef.current = [];

      if (queued.length === 0) {
        return;
      }

      startTransition(() => {
        setArtists((current) => {
          const seen = new Set(current.map((artist) => artist.slug));
          const uniqueIncoming: CategoryArtistCard[] = [];

          for (const artist of queued) {
            if (seen.has(artist.slug)) {
              continue;
            }

            seen.add(artist.slug);
            uniqueIncoming.push(artist);
          }

          if (uniqueIncoming.length === 0) {
            return current;
          }

          return [...current, ...uniqueIncoming];
        });
      });
    });
  }

  useEffect(() => () => {
    if (appendFlushFrameRef.current !== null) {
      window.cancelAnimationFrame(appendFlushFrameRef.current);
      appendFlushFrameRef.current = null;
    }

    if (measureRafRef.current !== null) {
      window.cancelAnimationFrame(measureRafRef.current);
      measureRafRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const cachedFull = readCategoryArtistsFullPayloadFromCache(slug);
      if (cachedFull) {
        if (!cancelled) {
          startTransition(() => {
            setArtists(cachedFull.artists);
            setTotalArtists(cachedFull.totalArtists);
          });
          setIsLoading(false);
        }
      }

      let seedPayload: CategoryArtistsFirstPayload | null = null;

      if (!cachedFull) {
        const cachedFirst = readCategoryArtistsFirstPayloadFromSessionCache(slug);
        if (cachedFirst) {
          seedPayload = cachedFirst;

          if (!cancelled) {
            startTransition(() => {
              setArtists(cachedFirst.artists);
              setTotalArtists(cachedFirst.totalArtists);
            });
            setIsLoading(false);
          }
        }
      }

      if (!seedPayload && !cachedFull) {
        seedPayload = await prefetchCategoryArtistsFirstPayload(slug);

        if (!cancelled && seedPayload) {
          startTransition(() => {
            setArtists(seedPayload?.artists ?? []);
            setTotalArtists(seedPayload?.totalArtists ?? null);
          });
          setIsLoading(false);
        }
      }

      const fullPayload = await primeCategoryArtistsFullPayload(slug, {
        seedPayload,
        onPage: (pageArtists) => {
          if (cancelled) {
            return;
          }

          appendArtists(pageArtists);
        },
      });

      if (cancelled || !fullPayload) {
        return;
      }

      startTransition(() => {
        setArtists((current) => {
          if (current.length === fullPayload.artists.length) {
            const currentLastSlug = current[current.length - 1]?.slug ?? null;
            const nextLastSlug = fullPayload.artists[fullPayload.artists.length - 1]?.slug ?? null;
            if (currentLastSlug === nextLastSlug) {
              return current;
            }
          }

          return fullPayload.artists;
        });
        setTotalArtists(fullPayload.totalArtists);
      });
      setIsLoading(false);
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    const handleCacheUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{ slug?: string }>;
      if (customEvent.detail?.slug !== slug) {
        return;
      }

      const cached = readCategoryArtistsFullPayloadFromCache(slug) ?? readCategoryArtistsFirstPayloadFromSessionCache(slug);
      if (!cached) {
        return;
      }

      startTransition(() => {
        setArtists(cached.artists);
        setTotalArtists(cached.totalArtists);
      });
    };

    window.addEventListener(CATEGORY_ARTISTS_CACHE_EVENT, handleCacheUpdate as EventListener);
    return () => {
      window.removeEventListener(CATEGORY_ARTISTS_CACHE_EVENT, handleCacheUpdate as EventListener);
    };
  }, [slug]);

  useEffect(() => {
    const handleFilterUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{ slug?: string; value?: string }>;
      if (customEvent.detail?.slug !== slug) {
        return;
      }

      setFilterValue(customEvent.detail?.value ?? "");
    };

    setFilterValue(readCategoryArtistsFilter(slug));
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

    setSelectedTab(readCategoryArtistsTab(slug));
    window.addEventListener(CATEGORY_ARTISTS_TAB_EVENT, handleTabUpdate as EventListener);
    return () => {
      window.removeEventListener(CATEGORY_ARTISTS_TAB_EVENT, handleTabUpdate as EventListener);
    };
  }, [slug]);

  const normalizedFilterValue = filterValue.trim().toLowerCase();
  const selectedTabMatcher = resolveCategoryArtistTabById(genre, selectedTab);
  const filteredArtists = useMemo(() => {
    return artists.filter((artist) => {
      if (selectedTabMatcher && !selectedTabMatcher.matches(artist.dominantGenre)) {
        return false;
      }

      if (!normalizedFilterValue) {
        return true;
      }

      const name = artist.name.toLowerCase();
      const genreLabel = (artist.dominantGenre ?? genre).toLowerCase();
      return name.includes(normalizedFilterValue) || genreLabel.includes(normalizedFilterValue);
    });
  }, [artists, genre, normalizedFilterValue, selectedTabMatcher]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const host = findScrollParent(viewport);

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

      if (host === window) {
        scrollTop = window.scrollY;
        viewportHeight = window.innerHeight;
        listTop = viewportRect.top + window.scrollY;
      } else {
        const hostRect = host.getBoundingClientRect();
        scrollTop = host.scrollTop;
        viewportHeight = host.clientHeight;
        listTop = viewportRect.top - hostRect.top + host.scrollTop;
      }

      const visibleStart = scrollTop - listTop;
      const visibleEnd = scrollTop + viewportHeight - listTop;
      const effectiveRowHeight = DEFAULT_ROW_HEIGHT;

      const startRow = Math.max(0, Math.floor(visibleStart / effectiveRowHeight) - VIRTUAL_OVERSCAN_ROWS);
      const endRow = Math.min(
        totalRows,
        Math.ceil(visibleEnd / effectiveRowHeight) + VIRTUAL_OVERSCAN_ROWS,
      );

      setVirtualRange((current) => {
        if (current.startRow === startRow && current.endRow === endRow) {
          return current;
        }

        return { startRow, endRow: Math.max(startRow + 1, endRow) };
      });
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

    if (host === window) {
      window.addEventListener("scroll", scheduleMetrics, { passive: true });
    } else {
      host.addEventListener("scroll", scheduleMetrics, { passive: true });
    }
    window.addEventListener("resize", scheduleMetrics, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      scheduleMetrics();
    });
    resizeObserver.observe(viewport);

    return () => {
      if (host === window) {
        window.removeEventListener("scroll", scheduleMetrics);
      } else {
        host.removeEventListener("scroll", scheduleMetrics);
      }
      window.removeEventListener("resize", scheduleMetrics);
      resizeObserver.disconnect();
    };
  }, [filteredArtists.length]);

  useEffect(() => {
    setVirtualRange({ startRow: 0, endRow: 24 });
  }, [normalizedFilterValue, selectedTab, slug]);

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

  return artists.length > 0 ? (
    <section className="artistBrowserPage" aria-busy={isLoading && artists.length === 0}>
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
            {rowArtists.map((artist) => (
              <Link
                key={artist.slug}
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
                      reportReason="category-artist-thumbnail-load-error"
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
    <section className="artistBrowserPage" aria-busy={isLoading}>
      <div className="routeContractRow artistLoadingCenter" role="status" aria-live="polite" aria-label={`Loading artists for ${genre}`}>
        <span className="playerBootBars" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
        <p>
          {isLoading ? `Loading artists for ${genre}...` : `No artists available for ${genre} right now.`}
          {typeof totalArtists === "number" ? ` ${totalArtists.toLocaleString("en-US")} artists total.` : ""}
        </p>
      </div>
    </section>
  );
}