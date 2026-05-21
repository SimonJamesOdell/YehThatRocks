"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import { CloseLink } from "@/components/close-link";
import { OverlayHeader } from "@/components/overlay-header";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";
import type { CategoryArtistCard } from "@/lib/catalog-data";

type CategoryArtistsInfiniteProps = {
  slug: string;
  genre: string;
  allArtists: CategoryArtistCard[];
  isAdmin?: boolean;
  hiddenVideoIds?: string[];
};

export function CategoryArtistsInfinite({
  slug,
  genre,
  allArtists,
  isAdmin = false,
  hiddenVideoIds = [],
}: CategoryArtistsInfiniteProps) {
  const [artistsState, setArtistsState] = useState<CategoryArtistCard[]>(allArtists);
  const [isLoadingArtists, setIsLoadingArtists] = useState(allArtists.length === 0);
  const [filterValue, setFilterValue] = useState("");
  const [pinningArtistSlug, setPinningArtistSlug] = useState<string | null>(null);
  const [, startArtistsRenderTransition] = useTransition();

  useEffect(() => {
    setArtistsState(allArtists);
    setIsLoadingArtists(allArtists.length === 0);
  }, [allArtists]);

  useEffect(() => {
    if (allArtists.length > 0) {
      return;
    }

    let cancelled = false;

    const loadArtists = async () => {
      setIsLoadingArtists(true);
      setArtistsState([]);
      try {
        let offset = 0;
        const pageSize = 192;
        let pendingAppend: CategoryArtistCard[] = [];
        for (let page = 0; page < 40; page += 1) {
          const response = await fetch(`/api/categories/${encodeURIComponent(slug)}/artists?limit=${pageSize}&offset=${offset}`, {
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
          const shouldFlushChunk = pendingAppend.length >= pageSize * 2 || !hasMore || pageArtists.length === 0;
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
  const artists = useMemo(() => {
    if (!normalizedFilter) {
      return artistsState;
    }

    return artistsState.filter((artist) => artist.name.toLowerCase().includes(normalizedFilter));
  }, [artistsState, normalizedFilter]);

  const artistsLabel = useMemo(() => {
    const total = artistsState.length;
    if (!normalizedFilter) {
      return `${total.toLocaleString("en-US")} artists`;
    }

    return `${artists.length.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} artists`;
  }, [artistsState.length, artists.length, normalizedFilter]);

  const handlePinCategoryThumbnail = useCallback(async (event: React.MouseEvent<HTMLButtonElement>, artistSlug: string, thumbnailVideoId: string) => {
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
          target: "category",
          genre,
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
                          void handlePinCategoryThumbnail(event, artist.slug, artist.thumbnailVideoId as string);
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
                <h3 className="artistResultName">{artist.name}</h3>
                <p className="artistResultGenre statusLabel">{genre}</p>
                <p>{artist.videoCount.toLocaleString("en-US")} videos in category</p>
              </Link>
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
