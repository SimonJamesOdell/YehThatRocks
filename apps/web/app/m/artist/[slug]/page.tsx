"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { MobileVideoList } from "@/components/mobile/mobile-video-card";
import type { MobileVideo } from "@/components/mobile/mobile-player-context";

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
  const router = useRouter();
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
      <div className="mobile-artist-header">
        <button
          type="button"
          className="mobile-back-button"
          onClick={() => router.back()}
          aria-label="Go back"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="mobile-artist-header-name">{displayName}</h1>
      </div>

      {artist?.thumbnailVideoId && (
        <div className="mobile-artist-hero">
          <img
            src={`https://i.ytimg.com/vi/${encodeURIComponent(artist.thumbnailVideoId)}/hqdefault.jpg`}
            alt={displayName}
            className="mobile-artist-hero-img"
          />
        </div>
      )}

      {(artist?.videoCount !== undefined) && (
        <p className="mobile-page-subtitle" style={{ marginTop: artist?.thumbnailVideoId ? 4 : 0 }}>{artist.videoCount} videos</p>
      )}

      {loading && (
        <div className="mobile-loading">
          <span className="playerBootBars" aria-hidden="true"><span /><span /><span /><span /><span /></span>
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
