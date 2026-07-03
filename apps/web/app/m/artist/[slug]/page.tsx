"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MobileVideoList } from "../../_components/mobile-video-card";
import type { MobileVideo } from "../../_components/mobile-player-context";

export default function MobileArtistDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [videos, setVideos] = useState<MobileVideo[]>([]);
  const [artistName, setArtistName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const searchTerm = slug.replace(/-/g, " ");
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchTerm)}&limit=50`);
        const data = await res.json();
        if (!cancelled) {
          setVideos(data.videos || []);
          if (data.videos && data.videos.length > 0) {
            const first = data.videos[0];
            setArtistName(first.parsedArtist || first.channelTitle || searchTerm);
          } else {
            setArtistName(searchTerm);
          }
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
  }, [slug]);

  return (
    <div>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">{artistName || slug.replace(/-/g, " ")}</h1>
        <p className="mobile-page-subtitle">Videos by this artist</p>
      </div>

      {loading && (
        <div className="mobile-loading">
          <div className="mobile-loading-spinner" />
        </div>
      )}

      {error && (
        <div className="mobile-empty-state">
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && (
        <MobileVideoList videos={videos} />
      )}
    </div>
  );
}
