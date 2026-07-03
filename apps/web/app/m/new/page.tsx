"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { MobileVideoList } from "@/components/mobile/mobile-video-card";
import type { MobileVideo } from "@/components/mobile/mobile-player-context";

export default function MobileNewVideosPage() {
  const [videos, setVideos] = useState<MobileVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const skipRef = useRef(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadVideos = useCallback(async (currentSkip: number, append = false) => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      const res = await fetch(`/api/videos/newest?skip=${currentSkip}&take=30`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      if (data.ok) {
        setVideos((prev) => append ? [...prev, ...data.videos] : data.videos);
        setHasMore(data.hasMore);
        skipRef.current = data.nextOffset;
      }
    } catch (err) {
      if (!append) {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    } finally {
      loadingMoreRef.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      setError(null);
      skipRef.current = 0;
      await loadVideos(0);
      if (!cancelled) setLoading(false);
    }
    init();
    return () => { cancelled = true; };
  }, [loadVideos]);

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current) return;
    setLoadingMore(true);
    await loadVideos(skipRef.current, true);
    setLoadingMore(false);
  }, [hasMore, loadVideos]);

  const handleRetry = useCallback(() => {
    skipRef.current = 0;
    loadVideos(0);
  }, [loadVideos]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    if (!hasMore || loading) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void handleLoadMore();
        }
      },
      { rootMargin: "400px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, handleLoadMore]);

  // Auto-load more if the page content doesn't fill the viewport
  useEffect(() => {
    if (!hasMore || loading || videos.length === 0) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const raf = requestAnimationFrame(() => {
      const rect = sentinel.getBoundingClientRect();
      if (rect.top < window.innerHeight + 400) {
        void handleLoadMore();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [hasMore, loading, videos.length, handleLoadMore]);

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
          <p>{error}</p>
          <button type="button" className="mobile-retry-button" onClick={handleRetry}>
            Try Again
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <MobileVideoList videos={videos} />
          {hasMore && (
            <div ref={sentinelRef} style={{ height: 1, width: "100%" }} />
          )}
          {loadingMore && (
            <div className="mobile-loading" style={{ padding: "16px 0" }}>
              <div className="mobile-loading-spinner" />
            </div>
          )}
        </>
      )}
    </div>
  );
}