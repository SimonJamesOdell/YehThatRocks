"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { MobileFixedScroll } from "@/components/mobile/mobile-fixed-scroll";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");
const PAGE_SIZE = 40;

type Artist = {
  name: string;
  slug: string;
  genre?: string;
  videoCount?: number;
};

export default function MobileArtistsPage() {
  const [letter, setLetter] = useState("A");
  const [filterValue, setFilterValue] = useState("");
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const filterFirstChar = filterValue.trim().charAt(0).toUpperCase();
  const highlightedLetter = ALPHABET.includes(filterFirstChar) ? filterFirstChar : letter;
  const activeFilter = filterValue.trim();
  const effectiveLetter = activeFilter && ALPHABET.includes(filterFirstChar) ? filterFirstChar : letter;

  const seenSlugsRef = useRef<Set<string>>(new Set());

  const fetchArtistPage = useCallback(async (offset: number) => {
    try {
      const params = new URLSearchParams({
        letter: letter,
        offset: String(offset),
        limit: String(PAGE_SIZE),
      });
      if (activeFilter) params.set("filter", activeFilter);

      const res = await fetch(`/api/artists?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();

      const unique = (data.artists as Artist[]).filter((artist) => {
        if (seenSlugsRef.current.has(artist.slug)) return false;
        seenSlugsRef.current.add(artist.slug);
        return true;
      });

      if (unique.length > 0) {
        setArtists((prev) => [...prev, ...unique]);
      }

      return {
        added: unique.length,
        hasMore: Boolean(data.hasMore),
        nextOffset: offset + (data.artists as Artist[]).length,
      };
    } catch {
      return {
        added: 0,
        hasMore: false,
        nextOffset: offset,
        errorMessage: "Could not load more artists. Please retry.",
      };
    }
  }, [letter, activeFilter]);

  const {
    hasMore,
    isLoading: isPaginationLoading,
    loadError: paginationError,
    sentinelRef,
    loadMore,
    resetPagination,
    retryLoadMore,
  } = useInfiniteScroll({
    initialOffset: 0,
    initialHasMore: true,
    fetchPage: fetchArtistPage,
  });

  // Reload when letter or activeFilter changes
  const reloadIdRef = useRef(0);
  useEffect(() => {
    const id = ++reloadIdRef.current;
    let cancelled = false;

    async function reload() {
      setLoading(true);
      setReloadError(null);
      seenSlugsRef.current = new Set();

      try {
        const params = new URLSearchParams({
          letter: effectiveLetter,
          offset: "0",
          limit: String(PAGE_SIZE),
        });
        if (activeFilter) params.set("filter", activeFilter);

        const res = await fetch(`/api/artists?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load");
        const data = await res.json();

        if (id !== reloadIdRef.current) return;

        const initial = data.artists as Artist[];
        seenSlugsRef.current = new Set(initial.map((a) => a.slug));
        setArtists(initial);
        resetPagination({
          offset: initial.length,
          hasMore: Boolean(data.hasMore),
        });
      } catch {
        if (id !== reloadIdRef.current) return;
        setReloadError("Could not load artists. Please retry.");
      } finally {
        if (id !== reloadIdRef.current) return;
        setLoading(false);
      }
    }

    reload();
    return () => { cancelled = true; };
  }, [effectiveLetter, activeFilter, resetPagination, retryKey]);

  const handleLetterClick = (l: string) => {
    setFilterValue("");
    setLetter(l);
  };

  // Client-side supplement: filter already-loaded artists
  const filteredArtists = useMemo(() => {
    if (!activeFilter) return artists;
    return artists.filter((a) => a.name.toLowerCase().startsWith(activeFilter.toLowerCase()));
  }, [artists, activeFilter]);

  const handleRetry = useCallback(() => {
    setReloadError(null);
    setLoading(true);
    setRetryKey((k) => k + 1);
  }, []);

  return (
    <MobileFixedScroll>
      <div className="mobile-page-header mobile-page-header--with-filter">
        <h1 className="mobile-page-title">Artists</h1>
        <input
          type="text"
          className="mobile-filter-input mobile-filter-input--inline"
          placeholder="Filter artists..."
          aria-label="Filter artists by name"
          autoComplete="off"
          spellCheck={false}
          value={filterValue}
          onChange={(e) => setFilterValue(e.target.value)}
        />
      </div>

      <div className="mobile-alphabet-bar">
        {ALPHABET.map((l) => (
          <button
            key={l}
            type="button"
            className={`mobile-alphabet-letter ${l === highlightedLetter ? "mobile-alphabet-letter-active" : ""}`}
            onClick={() => handleLetterClick(l)}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="mobile-results-scroll">
        {loading && (
          <div className="mobile-loading">
            <span className="playerBootBars" aria-hidden="true"><span /><span /><span /><span /><span /></span>
          </div>
        )}

        {reloadError && !loading && (
          <div className="mobile-empty-state">
            <p>{reloadError}</p>
            <button type="button" className="mobile-retry-button" onClick={handleRetry}>
              Try Again
            </button>
          </div>
        )}

        {!loading && !reloadError && filteredArtists.length === 0 && (
          <div className="mobile-empty-state">
            <p>{activeFilter ? "No artists match your filter." : `No artists found for ${letter}.`}</p>
          </div>
        )}

        {!loading && filteredArtists.length > 0 && (
          <>
            <div className="mobile-artists-list">
              {filteredArtists.map((artist) => (
                <Link
                  key={artist.slug}
                  href={`/m/artist/${artist.slug}`}
                  className="mobile-artist-link"
                >
                  <span>{artist.name}</span>
                  {artist.videoCount ? (
                    <span className="mobile-artist-meta">{artist.videoCount} videos</span>
                  ) : null}
                </Link>
              ))}
            </div>

            {/* Infinite scroll sentinel */}
            {hasMore && (
              <div
                ref={sentinelRef}
                className="mobile-load-more-sentinel"
                aria-hidden="true"
              />
            )}

            {paginationError && (
              <div className="mobile-empty-state">
                <p>{paginationError}</p>
                <button type="button" className="mobile-retry-button" onClick={retryLoadMore}>
                  Try Again
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </MobileFixedScroll>
  );
}
