"use client";

import { useEffect, useState } from "react";
import { MobileVideoList } from "../_components/mobile-video-card";
import type { MobileVideo } from "../_components/mobile-player-context";

export default function MobileFavouritesPage() {
  const [videos, setVideos] = useState<MobileVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/favourites");
        if (res.status === 401) {
          if (!cancelled) setNeedsAuth(true);
          return;
        }
        if (!res.ok) throw new Error("Failed to load favourites");
        const data = await res.json();
        if (!cancelled) {
          setVideos(data.favourites || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

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
          <a href="/m/login" style={{ color: "var(--mobile-accent)", textDecoration: "none", marginTop: "12px", display: "inline-block" }}>
            Log in →
          </a>
        </div>
      )}

      {error && (
        <div className="mobile-empty-state">
          <p>{error}</p>
        </div>
      )}

      {!loading && !needsAuth && !error && (
        <MobileVideoList videos={videos} />
      )}
    </div>
  );
}
