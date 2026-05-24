"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { CloseLink } from "@/components/close-link";
import { OverlayHeader } from "@/components/overlay-header";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import {
  readCategoryArtistsFirstPayloadFromSessionCache,
  writeCategoryArtistsFirstPayloadToSessionCache,
} from "@/lib/category-artists-session-cache";
import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";
import type { CategoryArtistCard } from "@/lib/catalog-data";
import { TOP_LEVEL_GENRE_BUCKETS } from "@/lib/genre-buckets";

type CategoryArtistsInfiniteProps = {
  slug: string;
  genre: string;
  allArtists: CategoryArtistCard[];
  isAdmin?: boolean;
  hiddenVideoIds?: string[];
};

type ArtistBucketTab = {
  id: string;
  label: string;
  matches: (artist: CategoryArtistCard) => boolean;
};

function normalizeGenreToken(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function buildArtistBucketTabs(genre: string): readonly ArtistBucketTab[] {
  const isTopLevelBucket = TOP_LEVEL_GENRE_BUCKETS.some((bucket) => bucket.label === genre);
  if (!isTopLevelBucket) {
    return [{ id: "all", label: "All", matches: () => true }];
  }

  const hasAny = (artist: CategoryArtistCard, patterns: RegExp[]) => {
    const dominantGenre = normalizeGenreToken(artist.dominantGenre);
    if (!dominantGenre) {
      return false;
    }
    return patterns.some((pattern) => pattern.test(dominantGenre));
  };

  switch (genre) {
    case "Thrash & Power Metal":
      return [
        { id: "all", label: "All", matches: () => true },
        { id: "thrash", label: "Thrash", matches: (artist) => hasAny(artist, [/thrash/i]) },
        { id: "power-speed", label: "Power / Speed", matches: (artist) => hasAny(artist, [/power/i, /speed/i]) },
        { id: "groove", label: "Groove", matches: (artist) => hasAny(artist, [/groove/i]) },
      ];
    case "Black and Death Metal":
      return [
        { id: "all", label: "All", matches: () => true },
        { id: "black", label: "Black", matches: (artist) => hasAny(artist, [/black/i]) },
        { id: "death", label: "Death", matches: (artist) => hasAny(artist, [/death/i]) },
        { id: "grind", label: "Grind", matches: (artist) => hasAny(artist, [/grind/i]) },
      ];
    case "Doom & Sludge":
      return [
        { id: "all", label: "All", matches: () => true },
        { id: "doom", label: "Doom", matches: (artist) => hasAny(artist, [/doom/i]) },
        { id: "sludge-stoner", label: "Sludge / Stoner", matches: (artist) => hasAny(artist, [/sludge/i, /stoner/i]) },
        { id: "drone", label: "Drone", matches: (artist) => hasAny(artist, [/drone/i]) },
      ];
    case "Nu-metal & Metalcore":
      return [
        { id: "all", label: "All", matches: () => true },
        { id: "nu-metal", label: "Nu-metal", matches: (artist) => hasAny(artist, [/nu\s*metal/i]) },
        { id: "metalcore", label: "Metalcore", matches: (artist) => hasAny(artist, [/metalcore/i, /deathcore/i, /core/i]) },
        { id: "alt-rap", label: "Alt / Rap", matches: (artist) => hasAny(artist, [/alternative/i, /rap/i]) },
      ];
    case "Progressive & Experimental":
      return [
        { id: "all", label: "All", matches: () => true },
        { id: "progressive", label: "Progressive", matches: (artist) => hasAny(artist, [/progressive/i, /prog\b/i]) },
        { id: "post", label: "Post / Blackgaze", matches: (artist) => hasAny(artist, [/post/i, /blackgaze/i]) },
        { id: "industrial-tech", label: "Industrial / Tech", matches: (artist) => hasAny(artist, [/industrial/i, /technical/i, /djent/i, /mathcore/i]) },
      ];
    case "Classic and Symphonic Metal":
      return [
        { id: "all", label: "All", matches: () => true },
        { id: "traditional", label: "Traditional", matches: (artist) => hasAny(artist, [/heavy/i, /nwobhm/i, /traditional/i]) },
        { id: "symphonic", label: "Symphonic", matches: (artist) => hasAny(artist, [/symphonic/i]) },
        { id: "glam", label: "Glam", matches: (artist) => hasAny(artist, [/glam/i, /hair/i]) },
      ];
    case "Punk & Hardcore":
      return [
        { id: "all", label: "All", matches: () => true },
        { id: "punk", label: "Punk", matches: (artist) => hasAny(artist, [/punk/i]) },
        { id: "hardcore", label: "Hardcore", matches: (artist) => hasAny(artist, [/hardcore/i, /powerviolence/i, /crust/i, /d beat/i]) },
        { id: "emo", label: "Emo / Screamo", matches: (artist) => hasAny(artist, [/emo/i, /screamo/i]) },
      ];
    case "Rock & Alternative":
      return [
        { id: "all", label: "All", matches: () => true },
        { id: "classic-hard", label: "Classic / Hard", matches: (artist) => hasAny(artist, [/classic rock/i, /hard rock/i, /heavy rock/i]) },
        { id: "alt-indie", label: "Alt / Indie", matches: (artist) => hasAny(artist, [/alternative/i, /indie/i, /grunge/i, /shoegaze/i]) },
        { id: "other-rock", label: "Other Rock", matches: (artist) => hasAny(artist, [/rock/i]) },
      ];
    default:
      return [{ id: "all", label: "All", matches: () => true }];
  }
}

export function CategoryArtistsInfinite({
  slug,
  genre,
  allArtists,
  isAdmin = false,
  hiddenVideoIds = [],
}: CategoryArtistsInfiniteProps) {
  const artistBucketTabs = useMemo(() => buildArtistBucketTabs(genre), [genre]);
  const [artistsState, setArtistsState] = useState<CategoryArtistCard[]>(allArtists);
  const [visibleArtists, setVisibleArtists] = useState<CategoryArtistCard[]>(allArtists);
  const [isLoadingArtists, setIsLoadingArtists] = useState(allArtists.length === 0);
  const [totalArtists, setTotalArtists] = useState<number>(allArtists.length);
  const [filterValue, setFilterValue] = useState("");
  const [activeTabId, setActiveTabId] = useState<string>("all");
  const [initialTabCounts, setInitialTabCounts] = useState<Record<string, number> | null>(null);
  const [pinningArtistSlug, setPinningArtistSlug] = useState<string | null>(null);
  const [, startArtistsRenderTransition] = useTransition();
  const renderTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setActiveTabId("all");
    setArtistsState(allArtists);
    setVisibleArtists(allArtists);
    setIsLoadingArtists(allArtists.length === 0);
    setTotalArtists(allArtists.length);
    setInitialTabCounts(null);
  }, [allArtists]);

  useEffect(() => {
    if (allArtists.length > 0) {
      return;
    }

    let cancelled = false;

    const loadArtists = async () => {
      setIsLoadingArtists(true);
      const cachedFirstPayload = readCategoryArtistsFirstPayloadFromSessionCache(slug);
      if (cachedFirstPayload && !cancelled) {
        setArtistsState(Array.isArray(cachedFirstPayload.artists) ? cachedFirstPayload.artists : []);
        setInitialTabCounts(cachedFirstPayload.tabCounts && typeof cachedFirstPayload.tabCounts === "object" ? cachedFirstPayload.tabCounts : null);
        if (typeof cachedFirstPayload.totalArtists === "number" && Number.isFinite(cachedFirstPayload.totalArtists)) {
          setTotalArtists(Math.max(cachedFirstPayload.artists.length, cachedFirstPayload.totalArtists));
        } else {
          setTotalArtists(cachedFirstPayload.artists.length);
        }
      } else {
        setArtistsState([]);
      }
      try {
        const firstPageSize = 30;
        const backgroundPageSize = 192;
        let offset = 0;
        let firstHasMore = false;
        let firstArtists: CategoryArtistCard[] = [];

        if (cachedFirstPayload) {
          firstArtists = Array.isArray(cachedFirstPayload.artists) ? cachedFirstPayload.artists : [];
          firstHasMore = cachedFirstPayload.hasMore === true;
          const cachedNextOffset = Number(cachedFirstPayload.nextOffset);
          offset = Number.isFinite(cachedNextOffset) ? cachedNextOffset : firstArtists.length;
        } else {
          const firstResponse = await fetch(`/api/categories/${encodeURIComponent(slug)}/artists?limit=${firstPageSize}&offset=0`, {
            cache: "no-store",
          });

          if (!firstResponse.ok) {
            return;
          }

          const firstPayload = (await firstResponse.json()) as {
            artists?: CategoryArtistCard[];
            totalArtists?: number | null;
            tabCounts?: Record<string, number> | null;
            hasMore?: boolean;
            nextOffset?: number;
          };

          firstArtists = Array.isArray(firstPayload.artists) ? firstPayload.artists : [];
          const normalizedFirstPayload = {
            artists: firstArtists,
            totalArtists: typeof firstPayload.totalArtists === "number" && Number.isFinite(firstPayload.totalArtists)
              ? firstPayload.totalArtists
              : null,
            tabCounts: firstPayload.tabCounts && typeof firstPayload.tabCounts === "object" ? firstPayload.tabCounts : null,
            hasMore: firstPayload.hasMore === true,
            nextOffset: Number.isFinite(Number(firstPayload.nextOffset)) ? Number(firstPayload.nextOffset) : firstArtists.length,
          };
          writeCategoryArtistsFirstPayloadToSessionCache(slug, normalizedFirstPayload);

          if (!cancelled) {
            setArtistsState(firstArtists);
            setInitialTabCounts(normalizedFirstPayload.tabCounts);
            if (typeof normalizedFirstPayload.totalArtists === "number" && Number.isFinite(normalizedFirstPayload.totalArtists)) {
              setTotalArtists(Math.max(firstArtists.length, normalizedFirstPayload.totalArtists));
            } else {
              setTotalArtists(firstArtists.length);
            }
          }

          firstHasMore = normalizedFirstPayload.hasMore;
          offset = normalizedFirstPayload.nextOffset;
        }

        if (!firstHasMore || firstArtists.length === 0) {
          return;
        }

        const pageSize = 192;
        let pendingAppend: CategoryArtistCard[] = [];
        for (let page = 0; page < 40; page += 1) {
          const response = await fetch(`/api/categories/${encodeURIComponent(slug)}/artists?limit=${backgroundPageSize}&offset=${offset}`, {
            cache: "no-store",
          });

          if (!response.ok) {
            break;
          }

          const payload = (await response.json()) as {
            artists?: CategoryArtistCard[];
            hasMore?: boolean;
            nextOffset?: number;
          };
          const pageArtists = Array.isArray(payload.artists) ? payload.artists : [];
          pendingAppend.push(...pageArtists);

          const hasMore = payload.hasMore === true;
          const shouldFlushChunk = pendingAppend.length >= backgroundPageSize * 2 || !hasMore || pageArtists.length === 0;
          if (!cancelled && shouldFlushChunk && pendingAppend.length > 0) {
            const chunkToAppend = pendingAppend;
            pendingAppend = [];
            startArtistsRenderTransition(() => {
              setArtistsState((current) => [...current, ...chunkToAppend]);
            });
          }

          if (!hasMore || pageArtists.length === 0) {
            break;
          }

          const nextOffset = Number(payload.nextOffset);
          offset = Number.isFinite(nextOffset) ? nextOffset : offset + pageArtists.length;
        }

      } finally {
        if (!cancelled) {
          setIsLoadingArtists(false);
        }
      }
    };

    void loadArtists();

    return () => {
      cancelled = true;
    };
  }, [allArtists.length, slug]);

  const normalizedFilter = filterValue.trim().toLowerCase();
  const artistsByTabId = useMemo(() => {
    const grouped = new Map<string, CategoryArtistCard[]>();
    for (const tab of artistBucketTabs) {
      grouped.set(tab.id, tab.id === "all" ? artistsState : artistsState.filter((artist) => tab.matches(artist)));
    }
    return grouped;
  }, [artistBucketTabs, artistsState]);

  const bucketFilteredArtists = artistsByTabId.get(activeTabId) ?? artistsByTabId.get("all") ?? artistsState;
  const matchedArtists = useMemo(() => {
    if (!normalizedFilter) {
      return bucketFilteredArtists;
    }

    return bucketFilteredArtists.filter((artist) => artist.name.toLowerCase().includes(normalizedFilter));
  }, [bucketFilteredArtists, normalizedFilter]);

  useEffect(() => {
    if (renderTimerRef.current !== null) {
      window.clearTimeout(renderTimerRef.current);
      renderTimerRef.current = null;
    }

    const initialBatchSize = matchedArtists.length > 240 ? 24 : 36;
    const firstSlice = matchedArtists.slice(0, initialBatchSize);
    setVisibleArtists(firstSlice);

    if (matchedArtists.length <= initialBatchSize) {
      return () => undefined;
    }

    const batchSize = 48;
    const appendDelayMs = 28;
    let nextIndex = initialBatchSize;
    let cancelled = false;

    const step = () => {
      if (cancelled) {
        return;
      }

      nextIndex = Math.min(nextIndex, matchedArtists.length);
      if (nextIndex >= matchedArtists.length) {
        renderTimerRef.current = null;
        return;
      }

      const chunk = matchedArtists.slice(nextIndex, nextIndex + batchSize);
      nextIndex += chunk.length;
      startArtistsRenderTransition(() => {
        setVisibleArtists((current) => {
          if (current.length === 0) {
            return firstSlice.concat(chunk);
          }
          return current.concat(chunk);
        });
      });

      renderTimerRef.current = window.setTimeout(step, appendDelayMs);
    };

    renderTimerRef.current = window.setTimeout(step, appendDelayMs);

    return () => {
      cancelled = true;
      if (renderTimerRef.current !== null) {
        window.clearTimeout(renderTimerRef.current);
        renderTimerRef.current = null;
      }
    };
  }, [matchedArtists, startArtistsRenderTransition]);

  const artists = visibleArtists;

  const artistsLabel = useMemo(() => {
    const total = Math.max(totalArtists, artistsState.length);
    if (!normalizedFilter && activeTabId === "all") {
      return `${total.toLocaleString("en-US")} artists`;
    }

    return `${artists.length.toLocaleString("en-US")} of ${matchedArtists.length.toLocaleString("en-US")} artists`;
  }, [activeTabId, artists.length, matchedArtists.length, normalizedFilter, totalArtists, artistsState.length]);

  const tabCountsById = useMemo(() => {
    const counts = new Map<string, number>();

    for (const [tabId, tabArtists] of artistsByTabId.entries()) {
      const tab = artistBucketTabs.find((entry) => entry.id === tabId);
      if (!tab) {
        continue;
      }

      const filteredCount = normalizedFilter
        ? tabArtists.filter((artist) => artist.name.toLowerCase().includes(normalizedFilter)).length
        : tabArtists.length;

      counts.set(tabId, filteredCount);
    }

    if (!normalizedFilter) {
      counts.set("all", Math.max(totalArtists, artistsState.length));
    }

    return counts;
  }, [artistBucketTabs, artistsByTabId, normalizedFilter, totalArtists]);
  const shouldRenderArtistTabs = allArtists.length > 0 || initialTabCounts !== null;

  const handlePinCategoryThumbnail = useCallback(async (
    event: React.MouseEvent<HTMLButtonElement>,
    artistSlug: string,
    artistName: string,
    thumbnailVideoId: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    if (!isAdmin || pinningArtistSlug === artistSlug) {
      return;
    }

    setPinningArtistSlug(artistSlug);
    try {
      await fetchWithAuthRetry("/api/admin/thumbnail-pins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: "category-artist",
          genre,
          artistName,
          thumbnailVideoId,
        }),
      });
    } finally {
      setPinningArtistSlug((current) => (current === artistSlug ? null : current));
    }
  }, [genre, isAdmin, pinningArtistSlug]);

  return (
    <>
      <OverlayHeader close={false}>
        <div className="newPageHeaderLeft">
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
          <div className="categoriesFilterBar">
            <input
              type="text"
              className="categoriesFilterInput"
              placeholder="filter artists..."
              value={filterValue}
              onChange={(event) => setFilterValue(event.target.value)}
              aria-label="Filter artists in this category"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <p className="categoryArtistCount" data-hidden-video-count={hiddenVideoIds.length}>{artistsLabel}</p>
        </div>
        <CloseLink />
      </OverlayHeader>

      {shouldRenderArtistTabs ? (
        <div className="categoriesBucketTabs" role="tablist" aria-label="Artist buckets">
          {artistBucketTabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const tabCount = tabCountsById.get(tab.id) ?? 0;
            const stableServerTabCount = !normalizedFilter && initialTabCounts
              ? initialTabCounts[tab.id]
              : undefined;
            const tabCountLabel = Number.isFinite(stableServerTabCount)
              ? Number(stableServerTabCount).toLocaleString("en-US")
              : tabCount.toLocaleString("en-US");
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={isActive ? "categoriesBucketTab categoriesBucketTabActive" : "categoriesBucketTab"}
                onClick={() => setActiveTabId(tab.id)}
              >
                {tab.label} ({tabCountLabel})
              </button>
            );
          })}
        </div>
      ) : null}

      {isLoadingArtists && artists.length === 0 ? (
        <div className="routeContractRow artistLoadingCenter" aria-live="polite" aria-busy="true">
          <span className="playerBootBars" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span>Loading artists...</span>
        </div>
      ) : artists.length > 0 ? (
        <div className="catalogGrid artistsCatalogGrid categoryArtistsGrid">
          {artists.map((artist) => (
            <div key={`${artist.slug}:${artist.name}`}>
              {(() => {
                const artistGenreLabel = artist.dominantGenre?.trim() || genre;
                return (
              <Link
                href={`/categories/${encodeURIComponent(slug)}/artists/${encodeURIComponent(artist.slug)}?name=${encodeURIComponent(artist.name)}`}
                className="catalogCard linkedCard artistResultCard"
                prefetch={false}
              >
                {artist.thumbnailVideoId ? (
                  <div className="categoryThumbWrap artistResultThumbWrap">
                    {isAdmin ? (
                      <button
                        type="button"
                        className="adminThumbnailPinButton"
                        aria-label="Set as category thumbnail"
                        title="Set as category thumbnail"
                        disabled={pinningArtistSlug === artist.slug}
                        onClick={(event) => {
                          void handlePinCategoryThumbnail(event, artist.slug, artist.name, artist.thumbnailVideoId as string);
                        }}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                      >
                        ◰
                      </button>
                    ) : null}
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
                <p className="artistResultGenre statusLabel">{artistGenreLabel}</p>
                <h3 className="artistResultName">{artist.name}</h3>
                <p>{artist.videoCount.toLocaleString("en-US")} videos in category</p>
              </Link>
                );
              })()}
            </div>
          ))}
        </div>
      ) : (
        <article className="catalogCard categoryNoVideos">
          <p className="statusLabel">Category artists</p>
          <h3>No artists match this filter.</h3>
          <p>Try a shorter search string.</p>
        </article>
      )}
    </>
  );
}
