import Link from "next/link";

import { OverlayHeader } from "@/components/overlay-header";
import { ScrollToTop } from "@/components/scroll-to-top";
import { MagazineInfiniteGrid } from "@/components/magazine-infinite-grid";
import { getPublishedArticles } from "@/lib/magazine-data";

export const revalidate = 3600;

export const metadata = {
  title: "Yeh Magazine — Rock and Metal",
  description: "Articles, deep dives, and essential tracks from the world of rock and heavy metal. Discover what to listen to and why it matters.",
};

export default async function MagazineLandingPage() {
  const articles = await getPublishedArticles(21);
  const [leadArticle, ...restArticles] = articles;

  return (
    <>
      <ScrollToTop />
      <OverlayHeader title="Magazine" />

      <main className="magazinePage" role="main" aria-label="Yeh Magazine">
      {leadArticle ? (
        <section className="magazineCoverStory panel" aria-label="Cover story">
          <Link
            href={`/magazine/${leadArticle.slug}`}
            className="magazineCoverStoryLink"
            aria-label={`Read article: ${leadArticle.title}`}
          />
          <img
            src={`https://i.ytimg.com/vi/${leadArticle.videoId}/maxresdefault.jpg`}
            alt={`${leadArticle.artist} - ${leadArticle.trackName}`}
            loading="eager"
            className="magazineCoverStoryThumb"
          />
          <div className="magazineCoverStoryBody">
            {leadArticle.kicker ? <p className="magazineSectionLabel">{leadArticle.kicker}</p> : null}
            <h2>{leadArticle.title}</h2>
            {leadArticle.deck ? <p>{leadArticle.deck}</p> : null}
            <div className="magazineCoverStoryActions">
              <Link href={`/?v=${leadArticle.videoId}&resume=1`} className="magazineWatchCta" data-overlay-close="true">Watch Now</Link>
            </div>
          </div>
        </section>
      ) : null}

      {restArticles.length > 0 ? (
        <MagazineInfiniteGrid
          initialArticles={restArticles}
          startOffset={articles.length}
        />
      ) : (
        // No initial articles from SSR — let the grid fetch its own from offset 1
        <MagazineInfiniteGrid initialArticles={[]} startOffset={1} />
      )}
      </main>
    </>
  );
}
