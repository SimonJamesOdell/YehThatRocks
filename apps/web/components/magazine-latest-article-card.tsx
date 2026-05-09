"use client";

import Link from "next/link";
import { useState } from "react";

type MagazineLatestArticleCardProps = {
  article: {
    slug: string;
    videoId: string | null;
    artist: string;
    trackName: string | null;
    kicker: string | null;
    genre: string;
    title: string;
    deck: string | null;
  };
  isAdmin: boolean;
};

export function MagazineLatestArticleCard({ article, isAdmin }: MagazineLatestArticleCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    if (!isAdmin || isDeleting) return;

    const confirmed = window.confirm(`Delete article \"${article.title}\"?`);
    if (!confirmed) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const response = await fetch(`/api/admin/magazine/${encodeURIComponent(article.slug)}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setDeleteError(payload?.error ?? "Delete failed");
        return;
      }

      setIsDeleted(true);
    } catch {
      setDeleteError("Delete failed");
    } finally {
      setIsDeleting(false);
    }
  }

  if (isDeleted) {
    return null;
  }

  const hasVideo = article.videoId !== null && article.videoId !== undefined;
  const artistSlug = String(article.artist || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  return (
    <article className="magazineTrackCard panel" data-magazine-article-slug={article.slug}>
      {hasVideo ? (
        <img
          src={`https://i.ytimg.com/vi/${article.videoId}/hqdefault.jpg`}
          alt={`${article.artist}${article.trackName ? ` - ${article.trackName}` : ""}`}
          loading="lazy"
          className="magazineTrackThumb"
        />
      ) : (
        <div className="magazineTrackThumb magazineTrackThumbPlaceholder" style={{ backgroundColor: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p style={{ color: "#999", textAlign: "center", padding: "1rem", fontSize: "0.9rem" }}>
            {article.artist}
          </p>
        </div>
      )}
      <div className="magazineTrackBody">
        <p className="magazineTrackGenre">{article.kicker ?? article.genre}</p>
        <h3>{article.title}</h3>
        {article.deck ? <p>{article.deck}</p> : null}
        <div className="magazineTrackActions">
          <Link href={`/magazine/${article.slug}`} className="magazineTextLink">Read article</Link>
          {hasVideo ? (
            <Link href={`/?v=${article.videoId}&resume=1`} className="magazineWatchCta" data-overlay-close="true">Watch now</Link>
          ) : (
            <Link href={`/artists/${artistSlug}`} className="magazineWatchCta" data-overlay-close="true">Explore artist</Link>
          )}
          {isAdmin ? (
            <button
              type="button"
              className="magazineAdminDeleteButton"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          ) : null}
        </div>
        {deleteError ? <p className="magazineAdminDeleteError">{deleteError}</p> : null}
      </div>
    </article>
  );
}
