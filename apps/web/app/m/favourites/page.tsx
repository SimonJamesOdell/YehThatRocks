"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { MobileVideoList } from "../_components/mobile-video-card";
import { useMobilePlayer } from "../_components/mobile-player-context";
import type { MobileVideo } from "../_components/mobile-player-context";

export default function MobileFavouritesPage() {
  const { auth } = useMobilePlayer();
  const [videos, setVideos] = useState<MobileVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFavourites = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsAuth(false);
    try {
      const res = await fetch("/api/favourites");
      if (res.status === 401) {
        setNeedsAuth(true);
        return;
      }
      if (!res.ok) throw new Error("Failed to load favourites");
      const data = await res.json();
      setVideos(data.favourites || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      await loadFavourites();
      if (cancelled) return;
    }
    init();
    return () => { cancelled = true; };
  }, [loadFavourites]);

  return (
    <div>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">Favourites</h1>
        <p className="mobile-page-subtitle">Your saved tracks</p>
      </div>

      {loading && (
        <div className="mobile-loading">
          <div className="mobile-loading-spinner" />
        </div>
      )}

      {needsAuth && (
        <div className="mobile-empty-state">
          <p>You need to log in to see your favourites.</p>
          <Link href="/m/login" className="mobile-retry-button" style={{ textDecoration: "none", color: "#fff", display: "inline-block" }}>
            Log in
          </Link>
        </div>
      )}

      {error && (
        <div className="mobile-empty-state">
          <p>{error}</p>
          <button type="button" className="mobile-retry-button" onClick={loadFavourites}>
            Try Again
          </button>
        </div>
      )}

      {!loading && !needsAuth && !error && (
        <MobileVideoList videos={videos} />
      )}
    </div>
  );
}
