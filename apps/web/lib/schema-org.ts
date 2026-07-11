/**
 * schema-org.ts
 *
 * Schema.org JSON-LD structured data builders for YehThatRocks.
 *
 * Phase 1 — SEO Foundation (TRAFFIC_ROADMAP.md items 1.1–1.5)
 *
 * Usage:
 *   import { buildVideoObject, buildBreadcrumbList, buildMusicRecording } from "@/lib/schema-org";
 *
 *   const jsonLd = buildVideoObject({ videoId: "abc123", title: "…", … });
 *   // then: <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
 */

const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://yehthatrocks.com").replace(/\/$/, "");
const SITE_NAME = "YehThatRocks";

// ── OG Image URL builder ────────────────────────────────────────────────────────

/**
 * Build a dynamic OG image URL for the /og endpoint.
 *
 * Usage:
 *   buildOgImageUrl({ type: "video", artist: "Metallica", title: "One", genre: "Thrash Metal" })
 *   // => "https://yehthatrocks.com/og?type=video&artist=Metallica&title=One&genre=Thrash+Metal"
 */
export function buildOgImageUrl(params: Record<string, string>): string {
  const origin = (process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://yehthatrocks.com").replace(/\/$/, "");
  const qs = new URLSearchParams(params);
  return `${origin}/og?${qs.toString()}`;
}

// ── Shared types ────────────────────────────────────────────────────────────────

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface VideoObjectInput {
  videoId: string;
  title: string;
  description?: string | null;
  artist?: string | null;
  trackName?: string | null;
  genre?: string | null;
  thumbnailUrl?: string | null;
  uploadDate?: string | null;
  duration?: string | null; // ISO 8601 duration, e.g. "PT4M30S"
  embedUrl?: string | null;
  interactionCount?: number | null; // e.g. favourite count
}

export interface MusicRecordingInput {
  trackName: string;
  artistName: string;
  genre?: string | null;
  url: string;
  videoId?: string | null;
  thumbnailUrl?: string | null;
}

export interface MusicGroupInput {
  artistName: string;
  slug: string;
  genre?: string | null;
  country?: string | null;
  thumbnailVideoId?: string | null;
  description?: string | null;
}

export interface ArticleInput {
  headline: string;
  description?: string | null;
  url: string;
  datePublished: string; // ISO 8601
  dateModified?: string | null;
  imageUrl?: string | null;
  authorName?: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function stripNulls<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined && value !== "") {
      result[key] = value;
    }
  }
  return result as Partial<T>;
}

/** Safely serialize a JSON-LD object, stripping undefined/null/empty values. */
export function jsonLdScript(ld: Record<string, unknown>): string {
  return JSON.stringify(stripNulls(ld));
}

// ── VideoObject ─────────────────────────────────────────────────────────────────

/**
 * Build a Schema.org VideoObject for a music video.
 *
 * @see https://schema.org/VideoObject
 * @see https://developers.google.com/search/docs/appearance/structured-data/video
 */
export function buildVideoObject(input: VideoObjectInput): Record<string, unknown> {
  const {
    videoId,
    title,
    description,
    artist,
    trackName,
    genre,
    thumbnailUrl,
    uploadDate,
    duration,
    embedUrl,
    interactionCount,
  } = input;

  const name = trackName && artist
    ? `${artist} — ${trackName}`
    : title;

  const resolvedDescription = description || `Watch ${name} on ${SITE_NAME} — the home of rock and metal streaming.`;
  const resolvedThumbnail = thumbnailUrl || `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
  const resolvedEmbedUrl = embedUrl || `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
  const resolvedUrl = `${SITE_ORIGIN}/?v=${encodeURIComponent(videoId)}`;

  return stripNulls({
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name,
    description: resolvedDescription,
    thumbnailUrl: resolvedThumbnail,
    embedUrl: resolvedEmbedUrl,
    url: resolvedUrl,
    ...(uploadDate ? { uploadDate } : {}),
    ...(duration ? { duration } : {}),
    ...(genre ? { genre } : {}),
    ...(artist ? {
      author: { "@type": "MusicGroup", name: artist },
      creator: { "@type": "MusicGroup", name: artist },
    } : {}),
    ...(interactionCount != null ? {
      interactionStatistic: {
        "@type": "InteractionCounter",
        interactionType: { "@type": "LikeAction" },
        userInteractionCount: interactionCount,
      },
    } : {}),
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_ORIGIN,
    },
  });
}

// ── MusicRecording ──────────────────────────────────────────────────────────────

/**
 * Build a Schema.org MusicRecording for a track.
 *
 * @see https://schema.org/MusicRecording
 */
export function buildMusicRecording(input: MusicRecordingInput): Record<string, unknown> {
  const { trackName, artistName, genre, url, videoId, thumbnailUrl } = input;

  return stripNulls({
    "@context": "https://schema.org",
    "@type": "MusicRecording",
    name: trackName,
    byArtist: {
      "@type": "MusicGroup",
      name: artistName,
    },
    url,
    ...(genre ? { genre } : {}),
    ...(videoId ? {
      video: buildVideoObject({
        videoId,
        title: `${artistName} — ${trackName}`,
        artist: artistName,
        trackName,
        genre,
        thumbnailUrl,
      }),
    } : {}),
    ...(thumbnailUrl ? { image: thumbnailUrl } : {}),
  });
}

// ── MusicGroup ──────────────────────────────────────────────────────────────────

/**
 * Build a Schema.org MusicGroup for an artist page.
 *
 * @see https://schema.org/MusicGroup
 */
export function buildMusicGroup(input: MusicGroupInput): Record<string, unknown> {
  const { artistName, slug, genre, country, thumbnailVideoId, description } = input;

  return stripNulls({
    "@context": "https://schema.org",
    "@type": "MusicGroup",
    name: artistName,
    url: `${SITE_ORIGIN}/artist/${encodeURIComponent(slug)}`,
    ...(thumbnailVideoId ? {
      image: `https://i.ytimg.com/vi/${encodeURIComponent(thumbnailVideoId)}/hqdefault.jpg`,
    } : {}),
    ...(genre ? { genre } : {}),
    ...(country && country !== "Unknown" ? {
      foundingLocation: { "@type": "Place", name: country },
    } : {}),
    ...(description ? { description } : {
      description: `${artistName} music videos on YehThatRocks — the home of rock and metal streaming.`,
    }),
    subjectOf: {
      "@type": "WebPage",
      url: `${SITE_ORIGIN}/artist/${encodeURIComponent(slug)}`,
      name: `${artistName} Videos | ${SITE_NAME}`,
    },
  });
}

// ── BreadcrumbList ──────────────────────────────────────────────────────────────

/**
 * Build a Schema.org BreadcrumbList.
 *
 * @see https://schema.org/BreadcrumbList
 */
export function buildBreadcrumbList(items: BreadcrumbItem[]): Record<string, unknown> {
  if (items.length === 0) return {};

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

// ── Article ─────────────────────────────────────────────────────────────────────

/**
 * Build a Schema.org Article (or NewsArticle) for magazine content.
 *
 * @see https://schema.org/Article
 * @see https://schema.org/NewsArticle
 */
export function buildArticle(input: ArticleInput & { isNews?: boolean }): Record<string, unknown> {
  const {
    headline,
    description,
    url,
    datePublished,
    dateModified,
    imageUrl,
    authorName,
    isNews,
  } = input;

  return stripNulls({
    "@context": "https://schema.org",
    "@type": isNews ? "NewsArticle" : "Article",
    headline,
    ...(description ? { description } : {}),
    url,
    datePublished,
    ...(dateModified ? { dateModified } : {}),
    ...(imageUrl ? { image: imageUrl } : {}),
    author: {
      "@type": "Organization",
      name: authorName || SITE_NAME,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_ORIGIN,
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
  });
}

// ── WebSite (for root layout) ───────────────────────────────────────────────────

/**
 * Build a Schema.org WebSite with SearchAction for the root page.
 *
 * @see https://schema.org/WebSite
 */
export function buildWebSite(description?: string): Record<string, unknown> {
  return stripNulls({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_ORIGIN,
    ...(description ? { description } : {
      description: "Stream and discover rock and metal music videos. 266,000+ videos across 153 genres including Heavy Metal, Thrash, Doom, Prog, Classic Rock, and more.",
    }),
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_ORIGIN}/artists?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  });
}

// ── ProfilePage (for artist wiki) ───────────────────────────────────────────────

/**
 * Build a Schema.org ProfilePage for artist wiki pages.
 *
 * @see https://schema.org/ProfilePage
 */
export function buildArtistWikiProfilePage(input: {
  artistName: string;
  slug: string;
  description?: string | null;
  dateModified?: string | null;
  thumbnailVideoId?: string | null;
}): Record<string, unknown> {
  const { artistName, slug, description, dateModified, thumbnailVideoId } = input;
  const url = `${SITE_ORIGIN}/artist/${encodeURIComponent(slug)}/wiki`;

  return stripNulls({
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    name: `${artistName} — Artist Wiki | ${SITE_NAME}`,
    url,
    ...(description ? { description } : {
      description: `Learn about ${artistName} — biography, discography, members, and more on ${SITE_NAME}.`,
    }),
    ...(dateModified ? { dateModified } : {}),
    ...(thumbnailVideoId ? {
      image: `https://i.ytimg.com/vi/${encodeURIComponent(thumbnailVideoId)}/hqdefault.jpg`,
    } : {}),
    about: {
      "@type": "MusicGroup",
      name: artistName,
      url: `${SITE_ORIGIN}/artist/${encodeURIComponent(slug)}`,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_ORIGIN,
    },
  });
}

// ── CollectionPage (for categories, top100, new, genres) ────────────────────────

/**
 * Build a Schema.org CollectionPage for listing pages.
 *
 * @see https://schema.org/CollectionPage
 */
export function buildCollectionPage(input: {
  name: string;
  url: string;
  description: string;
  itemCount?: number | null;
}): Record<string, unknown> {
  const { name, url, description, itemCount } = input;

  return stripNulls({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    url,
    description,
    ...(itemCount != null ? { numberOfItems: itemCount } : {}),
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: SITE_ORIGIN,
    },
  });
}
