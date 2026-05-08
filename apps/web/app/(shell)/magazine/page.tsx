import Link from "next/link";

import { OverlayHeader } from "@/components/overlay-header";
import { getPublishedArticles } from "@/lib/magazine-data";

export const revalidate = 3600;

export const metadata = {
  title: "Yeh Magazine — Rock and Metal",
  description: "Articles, deep dives, and essential tracks from the world of rock and heavy metal. Discover what to listen to and why it matters.",
};

export default async function MagazineLandingPage() {
  const articles = await getPublishedArticles(20);
  const [leadArticle, ...restArticles] = articles;

  return (
    <>
      <OverlayHeader title="Magazine" />

      <main className="magazinePage" role="main" aria-label="Yeh Magazine">
      {leadArticle ? (
        <section className="magazineCoverStory panel" aria-label="Cover story">
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
            <div className="magazineTrackActions">
              <Link href={`/magazine/${leadArticle.slug}`} className="magazinePrimaryCta">Read article</Link>
              <Link href={`/?v=${leadArticle.videoId}&resume=1`} className="magazineWatchCta" data-overlay-close="true">Play in Yeh</Link>
            </div>
          </div>
        </section>
      ) : null}

      {restArticles.length > 0 ? (
        <section className="magazineSectionBlock panel" aria-label="Latest articles">
          <div className="magazineSectionHeader">
            <h2>Latest Articles</h2>
          </div>
          <div className="magazineTrackGrid">
            {restArticles.map((article) => (
              <article key={article.slug} className="magazineTrackCard panel">
                <img
                  src={`https://i.ytimg.com/vi/${article.videoId}/hqdefault.jpg`}
                  alt={`${article.artist} - ${article.trackName}`}
                  loading="lazy"
                  className="magazineTrackThumb"
                />
                <div className="magazineTrackBody">
                  <p className="magazineTrackGenre">{article.genre}</p>
                  <h3>{article.title}</h3>
                  {article.deck ? <p>{article.deck}</p> : null}
                  <div className="magazineTrackActions">
                    <Link href={`/magazine/${article.slug}`} className="magazineTextLink">Read article</Link>
                    <Link href={`/?v=${article.videoId}&resume=1`} className="magazineWatchCta" data-overlay-close="true">Watch now</Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      </main>
    </>
  );
}

