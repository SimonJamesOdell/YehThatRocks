"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MobileVideoList } from "../../_components/mobile-video-card";
import type { MobileVideo } from "../../_components/mobile-player-context";

export default function MobileCategoryDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [videos, setVideos] = useState<MobileVideo[]>([]);
  const [categoryLabel, setCategoryLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const catRes = await fetch("/api/categories");
        const catData = await catRes.json();
        const cat = (catData.categories || []).find((c: { slug: string }) => c.slug === slug);
        if (!cancelled && cat) {
          setCategoryLabel(cat.label);
        }

        const searchRes = await fetch(`/api/search?q=${encodeURIComponent(slug.replace(/-/g, " "))}&limit=50`);
        const searchData = await searchRes.json();
        if (!cancelled) {
          setVideos(searchData.videos || []);
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
        <h1 className="mobile-page-title">{categoryLabel || slug.replace(/-/g, " ")}</h1>
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
        </div>
      )}

      {!loading && !error && (
        <MobileVideoList videos={videos} />
      )}
    </div>
  );
}
