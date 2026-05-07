import type { Metadata } from "next";
import { headers } from "next/headers";

import { getCurrentVideo } from "@/lib/catalog-data";

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
  const fallbackShareImage = `${siteOrigin}/images/guitar_back.png`;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const rawVideoId = typeof resolvedSearchParams?.v === "string" ? resolvedSearchParams.v : undefined;
  const selectedVideo = rawVideoId ? await getCurrentVideo(rawVideoId) : null;

  if (!selectedVideo?.id) {
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
            url: fallbackShareImage,
            alt: "YehThatRocks background artwork",
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title: DEFAULT_TITLE,
        description: DEFAULT_DESCRIPTION,
        images: [fallbackShareImage],
      },
    };
  }

  const shareUrl = `${siteOrigin}/?v=${encodeURIComponent(selectedVideo.id)}`;
  const shareTitle = `${selectedVideo.title} | ${SITE_NAME}`;
  const shareDescription = `Watch ${selectedVideo.title} on ${SITE_NAME}.`;
  const shareImage = `https://i.ytimg.com/vi/${encodeURIComponent(selectedVideo.id)}/hqdefault.jpg`;

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
          url: shareImage,
          width: 480,
          height: 360,
          alt: selectedVideo.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description: shareDescription,
      images: [shareImage],
    },
  };
}

const SITE_ORIGIN_STATIC = "https://yehthatrocks.com";

export default function Home() {
  // The shell layout owns the persistent player. The home route adds SEO-visible
  // content that is visually hidden but readable by search engines and screen readers.
  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "YehThatRocks",
    url: SITE_ORIGIN_STATIC,
    description:
      "Stream and discover rock and metal music videos. 266,000+ videos across 153 genres including Heavy Metal, Thrash, Doom, Prog, Classic Rock, and more.",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_ORIGIN_STATIC}/artists?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
      />
      <div className="seoLandingContent">
        <h1>YehThatRocks — Rock &amp; Metal Music Video Discovery</h1>
        <p>
          Stream over 266,000 rock and metal music videos across 153 genres. Discover new tracks,
          browse by artist or genre, and follow community-curated playlists.
        </p>
        <nav aria-label="Browse by genre">
          <ul>
            <li><a href="/categories/heavy-metal">Heavy Metal</a></li>
            <li><a href="/categories/thrash-metal">Thrash Metal</a></li>
            <li><a href="/categories/classic-rock">Classic Rock</a></li>
            <li><a href="/categories/doom-metal">Doom Metal</a></li>
            <li><a href="/categories/progressive-metal">Progressive Metal</a></li>
            <li><a href="/categories/death-metal">Death Metal</a></li>
            <li><a href="/categories/black-metal">Black Metal</a></li>
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

