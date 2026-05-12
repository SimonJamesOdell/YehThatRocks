import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OverlayHeader } from "@/components/overlay-header";
import { MagazineArticleLandingTracker } from "@/components/magazine-article-landing-tracker";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import { getArticleBySlug, getAllPublishedSlugs, getPublishedArticles, type MagazineBlock } from "@/lib/magazine-data";

type MagazineTrackPageProps = {
  params: Promise<{ slug: string }>;
};

export const revalidate = false;

export async function generateStaticParams() {
  const slugs = await getAllPublishedSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: MagazineTrackPageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) return {};

  const ogImage = article.videoId ? `https://i.ytimg.com/vi/${article.videoId}/maxresdefault.jpg` : undefined;
  const title = `${article.title} | Yeh Magazine`;
  const description = article.seoDescription ?? article.deck ?? undefined;

  return {
    title,
    description,
    keywords: article.seoKeywords ?? undefined,
    openGraph: {
      title,
      description,
      ...(ogImage ? { images: [{ url: ogImage, width: 1280, height: 720, alt: `${article.artist}${article.trackName ? ` - ${article.trackName}` : ""}` }] } : {}),
      type: "article",
      publishedTime: article.publishedAt.toISOString(),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

function renderBlock(block: MagazineBlock, index: number) {
  switch (block.type) {
    case "h2":
      return <h2 key={index}>{block.text}</h2>;
    case "quote":
      return (
        <blockquote key={index} className="magazineArticleQuote">
          <p>{block.text}</p>
          {block.attribution ? <cite>{block.attribution}</cite> : null}
        </blockquote>
      );
    case "p":
    default:
      return <p key={index}>{block.text}</p>;
  }
}

export default async function MagazineTrackPage({ params }: MagazineTrackPageProps) {
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
    <>
      <OverlayScrollReset />
      <OverlayHeader
        breadcrumb={(
          <>
            <Link href="/magazine" className="categoryHeaderBreadcrumbLink">Magazine</Link>
            <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
            <span className="categoryHeaderBreadcrumbCurrent magazineHeaderBreadcrumbCurrent" aria-current="page">
              {article.title}
            </span>
          </>
        )}
      />

      <main className="magazinePage" role="main" aria-label="Magazine article">
        <MagazineArticleLandingTracker slug={article.slug} />
        <div className="magazineArticleLayout">
          <article className="magazineArticle panel">
            {hasVideo ? (
              <img
                src={`https://i.ytimg.com/vi/${article.videoId}/maxresdefault.jpg`}
                alt={`${article.artist}${article.trackName ? ` - ${article.trackName}` : ""}`}
                className="magazineArticleThumb"
                loading="eager"
              />
            ) : (
              <div className="magazineArticleThumb magazineArticleThumbPlaceholder" style={{ backgroundColor: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <p style={{ color: "#999", textAlign: "center", fontSize: "1.2rem", fontWeight: "bold" }}>
                  {article.artist}
                </p>
              </div>
            )}

            <div className="magazineArticleBody">
              {article.body.map((block, i) => renderBlock(block, i))}
            </div>

            <div className="magazineArticleActions">
              {hasVideo ? (
                <Link
                  href={`/?v=${article.videoId}&resume=1`}
                  className="magazineWatchCta"
                  data-overlay-close="true"
                >
                  Watch now in YehThatRocks
                </Link>
              ) : (
                <Link
                  href={`/artists/${artistSlug}`}
                  className="magazineWatchCta"
                  data-overlay-close="true"
                >
                  Explore {article.artist}
                </Link>
              )}
              <Link href="/magazine" className="magazineTextLink">
                Back to magazine
              </Link>
            </div>
          </article>

          {relatedArticles.length > 0 ? (
            <aside className="magazineArticleSidebar panel" aria-label="More articles">
              <h2>More articles</h2>
              <div className="magazineArticleSidebarList">
                {relatedArticles.map((related) => {
                  const relatedHasVideo = related.videoId !== null && related.videoId !== undefined;
                  return (
                    <Link
                      key={related.slug}
                      href={`/magazine/${related.slug}`}
                      className="magazineArticleSidebarItem"
                    >
                      {relatedHasVideo ? (
                        <img
                          src={`https://i.ytimg.com/vi/${related.videoId}/mqdefault.jpg`}
                          alt={`${related.artist}${related.trackName ? ` - ${related.trackName}` : ""}`}
                          className="magazineArticleSidebarThumb"
                          loading="lazy"
                        />
                      ) : (
                        <div className="magazineArticleSidebarThumb" style={{ backgroundColor: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <p style={{ color: "#999", fontSize: "0.75rem", textAlign: "center" }}>{related.artist}</p>
                        </div>
                      )}
                      <div className="magazineArticleSidebarMeta">
                        <strong>{related.artist}</strong>
                        {related.trackName ? <span>{related.trackName}</span> : null}
                        <small>{related.kicker ?? related.genre}</small>
                      </div>
                    </Link>
                  );
                })}
              </div>
              <div className="magazineArticleSidebarActions">
                <Link href="/magazine" className="magazinePrimaryCta">All articles</Link>
              </div>
            </aside>
          ) : null}
        </div>
      </main>
    </>
  );
}
