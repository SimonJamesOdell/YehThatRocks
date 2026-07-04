"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");

type Artist = {
  name: string;
  slug: string;
  genre?: string;
  videoCount?: number;
};

export default function MobileArtistsPage() {
  const [letter, setLetter] = useState("A");
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadArtists = useCallback(async (lt: string, off: number, append = false) => {
    try {
      const res = await fetch(`/api/artists?letter=${lt}&offset=${off}&limit=40`);
      const data = await res.json();
      if (data.artists) {
        setArtists((prev) => append ? [...prev, ...data.artists] : data.artists);
        setHasMore(data.hasMore);
        setOffset(data.offset + data.artists.length);
      }
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      setArtists([]);
      setOffset(0);
      await loadArtists(letter, 0);
      if (!cancelled) setLoading(false);
    }
    init();
    return () => { cancelled = true; };
  }, [letter, loadArtists]);

  const handleLoadMore = useCallback(async () => {
    setLoadingMore(true);
    await loadArtists(letter, offset, true);
    setLoadingMore(false);
  }, [letter, offset, loadArtists]);

  return (
    <div>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">Artists</h1>
        <p className="mobile-page-subtitle">Browse 140,000+ artists A–Z</p>
      </div>

      <div className="mobile-alphabet-bar">
        {ALPHABET.map((l) => (
          <button
            key={l}
            type="button"
            className={`mobile-alphabet-letter ${l === letter ? "mobile-alphabet-letter-active" : ""}`}
            onClick={() => setLetter(l)}
          >
            {l}
          </button>
        ))}
      </div>

      {loading && (
        <div className="mobile-loading">
          <span className="playerBootBars" aria-hidden="true"><span /><span /><span /><span /><span /></span>
        </div>
      )}

      {!loading && artists.length === 0 && (
        <div className="mobile-empty-state">
          <p>No artists found for {letter}.</p>
        </div>
      )}

      {!loading && artists.length > 0 && (
        <>
          <div className="mobile-artists-list">
            {artists.map((artist) => (
              <Link
                key={artist.slug}
                href={`/m/artist/${artist.slug}`}
                className="mobile-artist-link"
              >
                <span>{artist.name}</span>
                {artist.videoCount && (
                  <span className="mobile-artist-meta">{artist.videoCount} videos</span>
                )}
              </Link>
            ))}
          </div>
          {hasMore && (
            <button
              type="button"
              className="mobile-load-more"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading..." : "Load More"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
