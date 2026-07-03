"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { MobileVideoList } from "../../_components/mobile-video-card";
import type { MobileVideo } from "../../_components/mobile-player-context";

export default function MobileCategoryDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [videos, setVideos] = useState<MobileVideo[]>([]);
  const [genreLabel, setGenreLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadVideos = useCallback(async (currentOffset: number, append = false) => {
    try {
      const res = await fetch(`/api/categories/${encodeURIComponent(slug)}?limit=30&offset=${currentOffset}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error("Category not found");
        throw new Error("Failed to load");
      }
      const data = await res.json();
      if (data.videos) {
        setVideos((prev) => append ? [...prev, ...data.videos] : data.videos);
        setHasMore(data.hasMore);
        setOffset(data.nextOffset);
        if (data.genre) {
          setGenreLabel(data.genre);
        }
      }
    } catch (err) {
      if (!append) {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    }
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      setError(null);
      setVideos([]);
      setOffset(0);
      setGenreLabel("");
      await loadVideos(0);
      if (!cancelled) setLoading(false);
    }
    init();
    return () => { cancelled = true; };
  }, [loadVideos]);

  const handleLoadMore = useCallback(async () => {
    setLoadingMore(true);
    await loadVideos(offset, true);
    setLoadingMore(false);
  }, [offset, loadVideos]);

  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    loadVideos(0).finally(() => setLoading(false));
  }, [loadVideos]);

  return (
    <div>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">{genreLabel || slug.replace(/-/g, " ")}</h1>
        <p className="mobile-page-subtitle">Browse videos in this genre</p>
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
