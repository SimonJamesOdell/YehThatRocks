"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CategoryArtistCard } from "@/lib/catalog-data-utils";

const CHUNK_SIZE = 40;

type Props = {
  artists: CategoryArtistCard[];
  genre: string;
};

export function MobileCategoryArtistList({ artists, genre }: Props) {
  const [visibleCount, setVisibleCount] = useState(CHUNK_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= artists.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + CHUNK_SIZE, artists.length));
        }
      },
      { rootMargin: "400px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, artists.length]);

  // Reset when artists change (new category)
  useEffect(() => {
    setVisibleCount(CHUNK_SIZE);
  }, [artists]);

  const visible = artists.slice(0, visibleCount);
  const hasMore = visibleCount < artists.length;

  return (
    <>
      <div className="mobile-artists-list">
        {visible.map((artist, index) => (
          <Link
            key={`${artist.slug}-${index}`}
            href={`/m/artist/${encodeURIComponent(artist.slug)}`}
            className="mobile-artist-link mobile-artist-link--with-thumb"
          >
            {artist.thumbnailVideoId ? (
              <img
                src={`https://i.ytimg.com/vi/${encodeURIComponent(artist.thumbnailVideoId)}/mqdefault.jpg`}
                alt={artist.name}
                className="mobile-artist-link-thumb"
                loading="lazy"
              />
            ) : (
              <div className="mobile-artist-link-thumb mobile-artist-link-thumb--placeholder" />
            )}
            <div className="mobile-artist-link-body">
              <span className="mobile-artist-link-name">{artist.name}</span>
              {artist.dominantGenre && artist.dominantGenre !== genre && (
                <span className="mobile-artist-link-genre">{artist.dominantGenre}</span>
              )}
            </div>
            <span className="mobile-artist-meta">
              {artist.videoCount.toLocaleString()} video{artist.videoCount !== 1 ? "s" : ""}
            </span>
          </Link>
        ))}
      </div>

      {hasMore && (
        <div ref={sentinelRef} className="mobile-load-more-sentinel" aria-hidden="true" />
      )}
    </>
  );
}
