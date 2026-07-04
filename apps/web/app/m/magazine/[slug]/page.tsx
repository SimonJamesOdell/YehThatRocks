import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { MagazineArticleComments } from "@/components/magazine-article-comments";
import { MagazineCTA } from "@/components/mobile/magazine-cta";
import { getArticleBySlug, getPublishedArticles, type MagazineBlock } from "@/lib/magazine-data";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) return {};

  return {
    title: `${article.title} | Yeh Magazine`,
    description: article.seoDescription ?? article.deck ?? undefined,
  };
}

function renderBlock(block: MagazineBlock, index: number) {
  switch (block.type) {
    case "h2":
      return <h2 key={index} className="mobile-magazine-h2">{block.text}</h2>;
    case "quote":
      return (
        <blockquote key={index} className="mobile-magazine-quote">
          <p>{block.text}</p>
          {block.attribution ? <cite>{block.attribution}</cite> : null}
        </blockquote>
      );
    case "p":
    default:
      return <p key={index} className="mobile-magazine-p">{block.text}</p>;
  }
}

export default async function MobileMagazineArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);

  if (!article) {
    notFound();
  }

  const allArticles = await getPublishedArticles(20);
  const relatedArticles = allArticles.filter((a) => a.slug !== article.slug).slice(0, 4);
  const hasVideo = article.videoId !== null && article.videoId !== undefined;
  const artistSlug = String(article.artist || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  return (
    <div className="mobile-magazine-article">
      <div className="mobile-page-header">
        <Link href="/m" className="mobile-magazine-back" aria-label="Go back">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <h1 className="mobile-page-title">{article.title}</h1>

      </div>

      {hasVideo ? (
        <img
          src={`https://i.ytimg.com/vi/${article.videoId}/maxresdefault.jpg`}
          alt={`${article.artist}${article.trackName ? ` - ${article.trackName}` : ""}`}
          className="mobile-magazine-thumb"
          loading="eager"
        />
      ) : (
        <div className="mobile-magazine-thumb mobile-magazine-thumb-placeholder">
          <p>{article.artist}</p>
        </div>
      )}

      <div className="mobile-magazine-body">
        {article.body.map((block, i) => renderBlock(block, i))}
      </div>

      <div className="mobile-magazine-actions">
        <MagazineCTA videoId={article.videoId ?? null} artist={article.artist} artistSlug={artistSlug} />
      </div>

      {relatedArticles.length > 0 && (
        <div className="mobile-magazine-related">
          <h2 className="mobile-magazine-related-title">More articles</h2>
          <div className="mobile-magazine-related-list">
            {relatedArticles.map((related) => (
              <a
                key={related.slug}
                href={`/m/magazine/${related.slug}`}
                className="mobile-magazine-card"
              >
                {related.videoId && (
                  <img
                    src={`https://i.ytimg.com/vi/${encodeURIComponent(related.videoId)}/mqdefault.jpg`}
                    alt=""
                    className="mobile-magazine-card-thumb"
                    loading="lazy"
                  />
                )}
                <div className="mobile-magazine-card-body">
                  <div className="mobile-magazine-card-kicker">{related.kicker || related.genre}</div>
                  <div className="mobile-magazine-card-title">{related.artist}{related.trackName ? ` — ${related.trackName}` : ""}</div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mobile-magazine-comments">
        <MagazineArticleComments slug={article.slug} />
      </div>
    </div>
  );
}