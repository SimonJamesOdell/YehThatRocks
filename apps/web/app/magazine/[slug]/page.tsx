import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getMagazineTrackBySlug, magazineDraftEdition } from "@/lib/magazine-draft";

type MagazineTrackPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return magazineDraftEdition.tracks.map((track) => ({ slug: track.slug }));
}

export default async function MagazineTrackPage({ params }: MagazineTrackPageProps) {
  const { slug } = await params;
  const track = getMagazineTrackBySlug(slug);

  if (!track) {
    notFound();
  }

  const backToArticleHref = encodeURIComponent(`/magazine/${track.slug}`);
  const relatedTracks = magazineDraftEdition.tracks.filter((editionTrack) => editionTrack.slug !== track.slug).slice(0, 3);

  return (
    <main className="magazinePage" role="main" aria-label="Magazine article">
      <header className="magazineArticleHero panel">
        <Link href="/magazine" className="magazineTextLink">Back to magazine</Link>
        <div className="magazineArticleHeroBrand">
          <Image
            src="/assets/images/yeh_main_logo.png?v=20260424-4"
            alt="Yeh That Rocks"
            width={420}
            height={128}
            unoptimized
            className="magazineArticleHeroLogo"
          />
          <p className="magazineArticleHeroTagline">The world&apos;s loudest website</p>
        </div>
        <p className="magazineKicker">{magazineDraftEdition.kicker}</p>
        <h1>{track.artist} - {track.title}</h1>
        <p className="magazineSummary">
          A focused editorial breakdown built to move from discovery to immediate listening in the Yeh watch shell.
        </p>
        <div className="magazineArticleMetaStrip" aria-label="Article details">
          <span>Genre: {track.genre}</span>
          <span>Edition: {magazineDraftEdition.title}</span>
          <span>Published: {magazineDraftEdition.publishedDate}</span>
        </div>
      </header>

      <div className="magazineArticleLayout">
        <article className="magazineArticle panel">
          <img
            src={`https://i.ytimg.com/vi/${track.videoId}/maxresdefault.jpg`}
            alt={`${track.artist} - ${track.title} thumbnail`}
            className="magazineArticleThumb"
            loading="eager"
          />

          <section className="magazineArticleQuickFacts" aria-label="Quick facts">
            <div>
              <h2>Quick take</h2>
              <p>{track.takeaway}</p>
            </div>
            <div>
              <h2>Track lane</h2>
              <p>{track.genre}</p>
            </div>
            <div>
              <h2>Listener profile</h2>
              <p>Ideal for heavy listeners building momentum into longer watch-next sessions.</p>
            </div>
          </section>

          <section className="magazineArticleBlock">
            <h2>Why it fits this edition</h2>
            <p>
              This slot balances accessibility with weight: an immediate hook, a memorable riff spine,
              and enough replay pull to transition into deeper catalog exploration.
            </p>
          </section>

          <section className="magazineArticleBlock">
            <h2>What to queue next</h2>
            <p>
              Use this track as an onboarding anchor, then move into adjacent subgenres to maintain energy while broadening
              discovery across artist links and related videos.
            </p>
          </section>

          <div className="magazineArticleActions">
            <Link href={`/?v=${track.videoId}&from=article&backTo=${backToArticleHref}`} className="magazineWatchCta">Watch now in YehThatRocks</Link>
            <Link href="/magazine" className="magazineTextLink">Open full edition</Link>
          </div>
        </article>

        <aside className="magazineArticleSidebar panel" aria-label="Edition navigation">
          <h2>In this edition</h2>
          <div className="magazineArticleSidebarList">
            {relatedTracks.map((relatedTrack) => (
              <Link key={relatedTrack.slug} href={`/magazine/${relatedTrack.slug}`} className="magazineArticleSidebarItem">
                <strong>{relatedTrack.artist} - {relatedTrack.title}</strong>
                <span>{relatedTrack.genre}</span>
              </Link>
            ))}
          </div>
          <div className="magazineArticleSidebarActions">
            <Link href="/magazine" className="magazinePrimaryCta">Browse all stories</Link>
            <Link href={`/?v=${track.videoId}&from=article&backTo=${backToArticleHref}`} className="magazineTextLink">Jump to player</Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
