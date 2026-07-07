"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MagazineLatestArticleCard } from "@/components/magazine-latest-article-card";

type ArticleFromApi = {
  slug: string;
  videoId: string | null;
  title: string;
  artist: string;
  trackName: string | null;
  kicker: string | null;
  deck: string | null;
  genre: string;
};

type Props = {
  initialArticles: ArticleFromApi[];
  startOffset: number;
};

const PAGE_SIZE = 8;

export function MagazineInfiniteGrid({ initialArticles, startOffset }: Props) {
  const [articles, setArticles] = useState<ArticleFromApi[]>(initialArticles);
  const [offset, setOffset] = useState(startOffset);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/magazine/latest?limit=${PAGE_SIZE}&offset=${offset}`);
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      const newArticles: ArticleFromApi[] = data.articles ?? [];
      if (newArticles.length > 0) {
        setArticles((prev) => [...prev, ...newArticles]);
      }
      setOffset((prev) => prev + newArticles.length);
      setHasMore(data.hasMore === true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, offset]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: "800px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  if (articles.length === 0) return null;

  return (
    <section className="magazineSectionBlock panel" aria-label="Latest articles">
      <div className="magazineSectionHeader">
        <h2>Latest Articles</h2>
      </div>
      <div className="magazineTrackGrid">
        {articles.map((article) => (
          <MagazineLatestArticleCard key={article.slug} article={article} />
        ))}
      </div>

      {/* Sentinel — triggers next page load when scrolled into view */}
      <div ref={sentinelRef} className="magazineLoadSentinel" />

      {loading ? (
        <div className="magazineLoadIndicator" aria-live="polite">
          <span className="magazineLoadSpinner" />
          <span>Loading more articles…</span>
        </div>
      ) : null}

      {error ? (
        <div className="magazineLoadIndicator magazineLoadIndicatorError" aria-live="polite">
          <span>Could not load more articles.</span>{" "}
          <button type="button" className="magazineRetryBtn" onClick={loadMore}>
            Retry
          </button>
        </div>
      ) : null}

      {!hasMore && articles.length > 0 ? (
        <p className="magazineLoadEnd" aria-live="polite">
          You have reached the end of the magazine back catalog.
        </p>
      ) : null}
    </section>
  );
}
