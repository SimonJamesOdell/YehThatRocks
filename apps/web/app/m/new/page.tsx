"use client";

import { useEffect, useState, useCallback } from "react";
import { MobileVideoList } from "../_components/mobile-video-card";
import type { MobileVideo } from "../_components/mobile-player-context";

export default function MobileNewVideosPage() {
  const [videos, setVideos] = useState<MobileVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadVideos = useCallback(async (currentSkip: number, append = false) => {
    try {
      const res = await fetch(`/api/videos/newest?skip=${currentSkip}&take=30`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      if (data.ok) {
        setVideos((prev) => append ? [...prev, ...data.videos] : data.videos);
        setHasMore(data.hasMore);
        setSkip(data.nextOffset);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      await loadVideos(0);
      if (!cancelled) setLoading(false);
    }
    init();
    return () => { cancelled = true; };
  }, [loadVideos]);

  const handleLoadMore = useCallback(async () => {
    setLoadingMore(true);
    await loadVideos(skip, true);
    setLoadingMore(false);
  }, [skip, loadVideos]);

  return (
    <div>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">New Videos</h1>
        <p className="mobile-page-subtitle">Latest additions to the catalog</p>
      </div>

      {loading && (
        <div className="mobile-loading">
          <div className="mobile-loading-spinner" />
        </div>
      )}

      {error && (
        <div className="mobile-empty-state">
          <p>Failed to load videos. Please try again.</p>
        </div>
      )}

      {!loading && !error && (
        <>
          <MobileVideoList videos={videos} />
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
