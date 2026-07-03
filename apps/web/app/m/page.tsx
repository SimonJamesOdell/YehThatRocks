"use client";

import { useEffect, useState } from "react";
import { MobileVideoList } from "./_components/mobile-video-card";
import type { MobileVideo } from "./_components/mobile-player-context";

export default function MobileHomePage() {
  const [videos, setVideos] = useState<MobileVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/videos/top?count=50");
        if (!res.ok) throw new Error("Failed to load videos");
        const data = await res.json();
        if (!cancelled) {
          setVideos(data.videos || []);
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
        <h1 className="mobile-page-title">Home</h1>
        <p className="mobile-page-subtitle">Top tracks on YehThatRocks</p>
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
        <MobileVideoList videos={videos} />
      )}
    </div>
  );
}
