"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

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
  const [filterValue, setFilterValue] = useState("");
  const [pinningArtistSlug, setPinningArtistSlug] = useState<string | null>(null);

  const normalizedFilter = filterValue.trim().toLowerCase();

  const artists = useMemo(() => {
    if (!normalizedFilter) {
      return allArtists;
    }

    return allArtists.filter((artist) => artist.name.toLowerCase().includes(normalizedFilter));
  }, [allArtists, normalizedFilter]);

  const artistsLabel = useMemo(() => {
    const total = allArtists.length;
    if (!normalizedFilter) {
      return `${total.toLocaleString("en-US")} artists`;
    }

    return `${artists.length.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} artists`;
  }, [allArtists.length, artists.length, normalizedFilter]);

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

      {artists.length > 0 ? (
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
