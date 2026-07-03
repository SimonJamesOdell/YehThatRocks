"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { MobileVideoList } from "../../_components/mobile-video-card";
import type { MobileVideo } from "../../_components/mobile-player-context";

type ArtistInfo = {
  name: string;
  slug: string;
  genre?: string;
  country?: string;
  videoCount?: number;
  thumbnailVideoId?: string;
};

export default function MobileArtistDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [videos, setVideos] = useState<MobileVideo[]>([]);
  const [artist, setArtist] = useState<ArtistInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/artists/${encodeURIComponent(slug)}`);
        if (res.status === 404) {
          if (!cancelled) setError("Artist not found");
          return;
        }
        if (!res.ok) throw new Error("Failed to load artist");
        const data = await res.json();
        if (!cancelled) {
          setArtist(data.artist);
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
  }, [slug]);

  const handleRetry = () => {
    setError(null);
    setLoading(true);
    fetch(`/api/artists/${encodeURIComponent(slug)}`)
      .then((res) => {
        if (res.status === 404) throw new Error("Artist not found");
        if (!res.ok) throw new Error("Failed to load artist");
        return res.json();
      })
      .then((data) => {
        setArtist(data.artist);
        setVideos(data.videos || []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  const displayName = artist?.name || slug.replace(/-/g, " ");

  return (
    <div>
      {artist?.thumbnailVideoId && (
        <div className="mobile-artist-hero">
          <img
            src={`https://i.ytimg.com/vi/${encodeURIComponent(artist.thumbnailVideoId)}/hqdefault.jpg`}
            alt={displayName}
            className="mobile-artist-hero-img"
          />
          <div className="mobile-artist-hero-overlay">
            <h1 className="mobile-artist-hero-name">{displayName}</h1>
            <div className="mobile-artist-hero-meta">
              {artist.genre && <span className="mobile-artist-hero-genre">{artist.genre}</span>}
              {artist.videoCount !== undefined && (
                <span className="mobile-artist-hero-count">{artist.videoCount} videos</span>
              )}
            </div>
          </div>
        </div>
      )}

      {!artist?.thumbnailVideoId && (
        <div className="mobile-page-header">
          <h1 className="mobile-page-title">{displayName}</h1>
          <p className="mobile-page-subtitle">
            {artist?.genre && <span>{artist.genre}{" "}&middot;{" "}</span>}
            {artist?.videoCount !== undefined && <span>{artist.videoCount} videos</span>}
          </p>
        </div>
      )}

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
        <MobileVideoList videos={videos} />
      )}
    </div>
  );
}
