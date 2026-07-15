import type { Metadata } from "next";
import { headers } from "next/headers";

import { getCurrentVideo } from "@/lib/catalog-data";
import {
  buildVideoObject,
  buildMusicRecording,
  buildBreadcrumbList,
  buildWebSite,
  buildOgImageUrl,
} from "@/lib/schema-org";

const SITE_NAME = "YehThatRocks";
const DEFAULT_TITLE = "YehThatRocks | The World's LOUDEST Website";
const DEFAULT_DESCRIPTION =
  "Community-driven rock and metal streaming, discovery, chat, and catalogue depth rebuilt for the modern web.";

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ searchParams }: HomePageProps): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "yehthatrocks.com";
  const proto = requestHeaders.get("x-forwarded-proto") || "https";
  const siteOrigin = `${proto}://${host}`;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const rawVideoId = typeof resolvedSearchParams?.v === "string" ? resolvedSearchParams.v : undefined;
  const selectedVideo = rawVideoId ? await getCurrentVideo(rawVideoId) : null;

  if (!selectedVideo?.id) {
    const ogHomeImage = `${siteOrigin}/images/yeh_share_fb.png`;
    return {
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      alternates: {
        canonical: siteOrigin,
      },
      openGraph: {
        title: DEFAULT_TITLE,
        description: DEFAULT_DESCRIPTION,
        url: siteOrigin,
        siteName: SITE_NAME,
        type: "website",
        images: [
          {
            url: ogHomeImage,
            width: 1200,
            height: 630,
            alt: "YehThatRocks — Rock & Metal Music Videos",
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title: DEFAULT_TITLE,
        description: DEFAULT_DESCRIPTION,
        images: [ogHomeImage],
      },
    };
  }

  const shareUrl = `${siteOrigin}/?v=${encodeURIComponent(selectedVideo.id)}`;
  const shareTitle = `${selectedVideo.title} | ${SITE_NAME}`;
  const shareDescription = `Watch ${selectedVideo.title} on ${SITE_NAME}.`;
  const artist = selectedVideo.parsedArtist || selectedVideo.channelTitle || "";
  const track = selectedVideo.parsedTrack || selectedVideo.title;
  const genre = selectedVideo.genre || "";
  const ogVideoImage = buildOgImageUrl({ type: "video", artist, title: track, genre });

  return {
    title: shareTitle,
    description: shareDescription,
    alternates: {
      canonical: shareUrl,
    },
    openGraph: {
      title: shareTitle,
      description: shareDescription,
      url: shareUrl,
      siteName: SITE_NAME,
      type: "video.other",
      images: [
        {
          url: ogVideoImage,
          width: 1200,
          height: 630,
          alt: selectedVideo.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description: shareDescription,
      images: [ogVideoImage],
    },
  };
}

const SITE_ORIGIN_STATIC = "https://yehthatrocks.com";

type HomeComponentProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeComponentProps) {
  // The shell layout owns the persistent player. The home route adds SEO-visible
  // content that is visually hidden but readable by search engines and screen readers.

  // ── Site-wide WebSite schema ────────────────────────────────────────────
  const websiteJsonLd = buildWebSite();

  // ── Video-specific schema when ?v= is present ───────────────────────────
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const rawVideoId = typeof resolvedSearchParams?.v === "string" ? resolvedSearchParams.v : undefined;
  const selectedVideo = rawVideoId ? await getCurrentVideo(rawVideoId) : null;

  const videoJsonLd = selectedVideo?.id
    ? buildVideoObject({
        videoId: selectedVideo.id,
        title: selectedVideo.title,
        description: selectedVideo.description,
        artist: selectedVideo.parsedArtist || selectedVideo.channelTitle,
        trackName: selectedVideo.parsedTrack,
        genre: selectedVideo.genre,
        interactionCount: selectedVideo.favourited,
      })
    : null;

  const musicRecordingJsonLd = selectedVideo?.id && selectedVideo.parsedTrack && (selectedVideo.parsedArtist || selectedVideo.channelTitle)
    ? buildMusicRecording({
        trackName: selectedVideo.parsedTrack,
        artistName: selectedVideo.parsedArtist || selectedVideo.channelTitle,
        genre: selectedVideo.genre,
        url: `${SITE_ORIGIN_STATIC}/?v=${encodeURIComponent(selectedVideo.id)}`,
        videoId: selectedVideo.id,
      })
    : null;

  // ── BreadcrumbList ──────────────────────────────────────────────────────
  const artistForBreadcrumb = selectedVideo?.parsedArtist || selectedVideo?.channelTitle;
  const breadcrumbJsonLd = selectedVideo?.id && artistForBreadcrumb
    ? buildBreadcrumbList([
        { name: "Home", url: SITE_ORIGIN_STATIC },
        { name: artistForBreadcrumb, url: `${SITE_ORIGIN_STATIC}/artist/${encodeURIComponent(artistForBreadcrumb.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))}` },
        { name: selectedVideo.parsedTrack || selectedVideo.title, url: `${SITE_ORIGIN_STATIC}/?v=${encodeURIComponent(selectedVideo.id)}` },
      ])
    : buildBreadcrumbList([
        { name: "Home", url: SITE_ORIGIN_STATIC },
      ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      {videoJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(videoJsonLd) }}
        />
      ) : null}
      {musicRecordingJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(musicRecordingJsonLd) }}
        />
      ) : null}
      <div className="seoLandingContent">
        <h1>YehThatRocks — Rock &amp; Metal Music Video Discovery</h1>
        <p>
          Stream over 266,000 rock and metal music videos across 153 genres. Discover new tracks,
          browse by artist or genre, and follow community-curated playlists.
        </p>
        <nav aria-label="Browse by genre">
          <ul>
            <li><a href="/categories/heavy-metal">Heavy Metal</a></li>
            <li><a href="/categories/thrash-power-metal">Thrash &amp; Power Metal</a></li>
            <li><a href="/categories/classic-rock">Classic Rock</a></li>
            <li><a href="/categories/doom-metal">Doom Metal</a></li>
            <li><a href="/categories/progressive-metal">Progressive Metal</a></li>
            <li><a href="/categories/death-metal">Death Metal</a></li>
            <li><a href="/categories/black-and-death-metal">Black and Death Metal</a></li>
            <li><a href="/categories/power-metal">Power Metal</a></li>
            <li><a href="/categories">All genres →</a></li>
          </ul>
        </nav>
        <p>
          <a href="/top100">Top 100 most-played videos</a> ·{" "}
          <a href="/new">New additions</a> ·{" "}
          <a href="/artists">Browse 140,000+ artists A–Z</a>
        </p>
      </div>
    </>
  );
}
