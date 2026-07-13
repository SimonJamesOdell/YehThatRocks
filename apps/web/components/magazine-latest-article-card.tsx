"use client";

import Link from "next/link";

import { MagazineWatchCta } from "@/components/magazine-watch-cta";

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
};

export function MagazineLatestArticleCard({ article }: MagazineLatestArticleCardProps) {

  const hasVideo = article.videoId !== null && article.videoId !== undefined;
  const artistSlug = String(article.artist || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  return (
    <article className="magazineTrackCard panel" data-magazine-article-slug={article.slug}>
      <Link href={`/magazine/${article.slug}`} className="magazineTrackLink">
        {hasVideo ? (
          <img
            src={`https://i.ytimg.com/vi/${article.videoId}/hqdefault.jpg`}
            alt={`${article.artist}${article.trackName ? ` - ${article.trackName}` : ""}`}
            loading="lazy"
            className="magazineTrackThumb"
          />
        ) : (
          <div className="magazineTrackThumb magazineTrackThumbPlaceholder" style={{ backgroundColor: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <p style={{ color: "#999", textAlign: "center", padding: "1rem", fontSize: "0.9rem" }}>Article</p>
          </div>
        )}
        <div className="magazineTrackBody">
          <p className="magazineTrackGenre">{article.kicker ?? article.genre}</p>
          <h3 className="magazineTrackTitle">{article.title}</h3>
          {article.deck ? <p>{article.deck}</p> : null}
        </div>
      </Link>
      <div className="magazineTrackActions">
        {hasVideo ? (
          <MagazineWatchCta videoId={article.videoId!} />
        ) : (
          <Link href={`/artists/${artistSlug}`} className="magazineWatchCta" data-overlay-close="true">Explore artist</Link>
        )}
      </div>
    </article>
  );
}