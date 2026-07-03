"use client";

import { useState, useCallback, useEffect, type FormEvent } from "react";
import { MobileVideoList } from "../_components/mobile-video-card";
import type { MobileVideo } from "../_components/mobile-player-context";

export default function MobileSearchPage() {
  const [query, setQuery] = useState("");
  const [videos, setVideos] = useState<MobileVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState("");

  const doSearch = useCallback(async (e?: FormEvent) => {
    if (e) e.preventDefault();
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    setSearched(true);
    setLastQuery(q);

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=50`);
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      setVideos(data.videos || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleRetry = useCallback(() => {
    if (lastQuery) {
      setLoading(true);
      setError(null);
      fetch(`/api/search?q=${encodeURIComponent(lastQuery)}&limit=50`)
        .then((res) => {
          if (!res.ok) throw new Error("Search failed");
          return res.json();
        })
        .then((data) => setVideos(data.videos || []))
        .catch((err) => setError(err instanceof Error ? err.message : "Search failed"))
        .finally(() => setLoading(false));
    }
  }, [lastQuery]);

  return (
    <div>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">Search</h1>
      </div>

      <form className="mobile-search-form" onSubmit={doSearch}>
        <input
          type="search"
          className="mobile-search-input"
          placeholder="Search artists, tracks, genres..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <button type="submit" className="mobile-search-button">
          Go
        </button>
      </form>

      {loading && (
        <div className="mobile-loading">
          <div className="mobile-loading-spinner" />
        </div>
      )}

      {error && (
        <div className="mobile-empty-state">
          <p>{error}</p>
          <button type="button" className="mobile-retry-button" onClick={handleRetry}>
            Try Again
          </button>
        </div>
      )}

      {!loading && searched && videos.length === 0 && !error && (
        <div className="mobile-empty-state">
          <p>No results found for &ldquo;{lastQuery}&rdquo;.</p>
        </div>
      )}

      {!loading && videos.length > 0 && (
        <MobileVideoList videos={videos} />
      )}

      {!searched && !loading && (
        <div className="mobile-empty-state">
          <p>Enter a search term above to find music.</p>
        </div>
      )}
    </div>
  );
}
