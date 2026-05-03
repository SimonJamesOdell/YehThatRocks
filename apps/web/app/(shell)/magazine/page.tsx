import Image from "next/image";
import Link from "next/link";

import { CloseLink } from "@/components/close-link";
import { OverlayHeader } from "@/components/overlay-header";
import { magazineDraftEdition } from "@/lib/magazine-draft";

export const metadata = {
  title: `${magazineDraftEdition.title} | Yeh Magazine`,
  description: magazineDraftEdition.summary,
};

export default function MagazineLandingPage() {
  const [leadTrack, ...restTracks] = magazineDraftEdition.tracks;
  const spotlightTracks = restTracks.slice(0, 3);

  const sectionNav = [
    { id: "cover-story", label: "Cover Story" },
    { id: "latest-stories", label: "Latest Stories" },
    { id: "tour-radar", label: "Tour Radar" },
    { id: "reviews", label: "Reviews" },
  ];

  return (
    <main className="magazinePage" role="main" aria-label="Yeh Magazine">
      <OverlayHeader className="magazineOverlayBar" close={false}>
        <div className="magazineOverlayBarBody">
          <strong className="magazineOverlayBarTitle">Magazine</strong>
        </div>
        <CloseLink />
      </OverlayHeader>

      <header className="magazineMasthead panel">
        <div className="magazineMastheadBrand">
          <Image
            src="/assets/images/yeh_main_logo.png?v=20260424-4"
            alt="Yeh That Rocks"
            width={520}
            height={158}
            unoptimized
            className="magazineMastheadLogo"
          />
          <p className="magazineMastheadTagline">The world&apos;s loudest website</p>
        </div>
        <nav className="magazineMastheadNav" aria-label="Magazine sections">
          {sectionNav.map((section) => (
            <a key={section.id} href={`#${section.id}`} className="magazineMastheadNavLink">
              {section.label}
            </a>
          ))}
        </nav>
      </header>

      <section className="magazineHeroBar panel">
        <p className="magazineKicker">{magazineDraftEdition.kicker}</p>
        <h1>{magazineDraftEdition.title}</h1>
        <p className="magazineSummary">{magazineDraftEdition.summary}</p>
        <div className="magazineMetaRow">
          <span>Published {magazineDraftEdition.publishedDate}</span>
          <div className="magazineMetaActions">
            <a href="#latest-stories" className="magazinePrimaryCta">Browse stories</a>
            <Link href={`/?v=${leadTrack?.videoId ?? ""}&resume=1`} className="magazineWatchCta" data-overlay-close="true">Watch now</Link>
          </div>
        </div>
      </section>

      <section id="cover-story" className="magazineCoverStory panel" aria-label="Cover story">
        <img
          src={`https://i.ytimg.com/vi/${leadTrack?.videoId ?? ""}/maxresdefault.jpg`}
          alt={`${leadTrack?.artist ?? ""} - ${leadTrack?.title ?? ""} thumbnail`}
          loading="eager"
          className="magazineCoverStoryThumb"
        />
        <div className="magazineCoverStoryBody">
          <p className="magazineSectionLabel">Cover Story</p>
          <h2>{leadTrack?.artist} - {leadTrack?.title}</h2>
          <p>{leadTrack?.takeaway}</p>
          <div className="magazineTrackActions">
            <Link href={`/magazine/${leadTrack?.slug ?? ""}`} className="magazinePrimaryCta">Read cover story</Link>
            <Link href={`/?v=${leadTrack?.videoId ?? ""}&resume=1`} className="magazineWatchCta" data-overlay-close="true">Play in Yeh</Link>
          </div>
        </div>
      </section>

      <section id="latest-stories" className="magazineSectionBlock panel" aria-label="Latest stories">
        <div className="magazineSectionHeader">
          <h2>Latest Stories</h2>
          <a href="#tour-radar" className="magazineTextLink">Jump to tour radar</a>
        </div>
        <div className="magazineTrackGrid">
          {magazineDraftEdition.tracks.map((track) => (
            <article key={track.slug} className="magazineTrackCard panel">
              <img
                src={`https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`}
                alt={`${track.artist} - ${track.title} thumbnail`}
                loading="lazy"
                className="magazineTrackThumb"
              />
              <div className="magazineTrackBody">
                <p className="magazineTrackGenre">{track.genre}</p>
                <h3>{track.artist} - {track.title}</h3>
                <p>{track.takeaway}</p>
                <div className="magazineTrackActions">
                  <Link href={`/magazine/${track.slug}`} className="magazineTextLink">Read article</Link>
                  <Link href={`/?v=${track.videoId}&resume=1`} className="magazineWatchCta" data-overlay-close="true">Watch now</Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="tour-radar" className="magazineSectionBlock panel" aria-label="Tour radar">
        <div className="magazineSectionHeader">
          <h2>Tour Radar</h2>
          <span>Inspired by recurring tour-dates lanes in leading metal outlets</span>
        </div>
        <div className="magazineMiniGrid">
          {spotlightTracks.map((track) => (
            <article key={`tour-${track.slug}`} className="magazineMiniCard">
              <p className="magazineSectionLabel">Tour watch</p>
              <h3>{track.artist}</h3>
              <p>{track.title} is trending in heavy rotation and likely to extend into tour-set staples.</p>
              <Link href={`/magazine/${track.slug}`} className="magazineTextLink">Read briefing</Link>
            </article>
          ))}
        </div>
      </section>

      <section id="reviews" className="magazineSectionBlock panel" aria-label="Reviews and picks">
        <div className="magazineSectionHeader">
          <h2>Reviews & Picks</h2>
          <span>A quick lane for deep cuts, album context, and editor recommendations</span>
        </div>
        <div className="magazineMiniGrid magazineMiniGridDense">
          {magazineDraftEdition.tracks.map((track) => (
            <article key={`review-${track.slug}`} className="magazineMiniCard">
              <p className="magazineTrackGenre">{track.genre}</p>
              <h3>{track.artist} - {track.title}</h3>
              <p>{track.takeaway}</p>
              <div className="magazineTrackActions">
                <Link href={`/magazine/${track.slug}`} className="magazineTextLink">Read full take</Link>
                <Link href={`/?v=${track.videoId}&resume=1`} className="magazineTextLink" data-overlay-close="true">Watch clip</Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
