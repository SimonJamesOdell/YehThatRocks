"use client";

import { useEffect, useState, useCallback } from "react";
import { MobileVideoList } from "@/components/mobile/mobile-video-card";
import type { MobileVideo } from "@/components/mobile/mobile-player-context";

export default function MobileTop100Page() {
  const [videos, setVideos] = useState<MobileVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadVideos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/videos/top?count=100");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setVideos(data.videos || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      await loadVideos();
      if (cancelled) return;
    }
    init();
    return () => { cancelled = true; };
  }, [loadVideos]);

  return (
    <div>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">Top 100</h1>
        <p className="mobile-page-subtitle">Most played tracks</p>
      </div>

      {loading && (
        <div className="mobile-loading">
          <div className="mobile-loading-spinner" />
        </div>
      )}

      {error && (
        <div className="mobile-empty-state">
          <p>{error}</p>
          <button type="button" className="mobile-retry-button" onClick={loadVideos}>
            Try Again
          </button>
        </div>
      )}

      {!loading && !error && (
        <MobileVideoList videos={videos} />
      )}
    </div>
  );
}
