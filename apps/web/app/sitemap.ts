import type { MetadataRoute } from "next";

import { getArtistSlugsForSitemap, getGenres, getGenreSlug } from "@/lib/catalog-data";
import { withSoftTimeout } from "@/lib/catalog-data-utils";
import { getAllPublishedSlugs } from "@/lib/magazine-data";

// Regenerate the sitemap every 24 hours so newly published articles are picked
// up without requiring a full redeploy. Artist/genre shards also benefit.
export const revalidate = 86400;

const SITE_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") ||
  "https://yehthatrocks.com";

// id=0: static pages + genres (~160 entries)
// id=1–3: artist pages with 2+ videos, 45k per page (covers up to 135k qualifying artists)
const ARTIST_SITEMAP_PAGE_SIZE = 45_000;
const ARTIST_SITEMAP_PAGES = 3;
const ARTIST_MIN_VIDEO_COUNT = 2;
const SITEMAP_QUERY_SOFT_TIMEOUT_MS = 2_500;

export async function generateSitemaps() {
  return [
    { id: 0 },
    ...Array.from({ length: ARTIST_SITEMAP_PAGES }, (_, i) => ({ id: i + 1 })),
    { id: 4 }, // magazine articles
  ];
}

function normalizeSitemapId(rawId: number | string): number {
  if (typeof rawId === "number" && Number.isFinite(rawId)) {
    return rawId;
  }
  const parsed = Number(rawId);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default async function sitemap({ id }: { id: number | string }): Promise<MetadataRoute.Sitemap> {
  const normalizedId = normalizeSitemapId(id);

  if (normalizedId === 0) {
    const genres = await withSoftTimeout(
      "sitemap:getGenres",
      SITEMAP_QUERY_SOFT_TIMEOUT_MS,
      () => getGenres(),
    ).catch(() => [] as string[]);

    const staticRoutes: MetadataRoute.Sitemap = [
      { url: SITE_ORIGIN, priority: 1.0, changeFrequency: "daily" },
      { url: `${SITE_ORIGIN}/categories`, priority: 0.9, changeFrequency: "weekly" },
      { url: `${SITE_ORIGIN}/top100`, priority: 0.9, changeFrequency: "weekly" },
      { url: `${SITE_ORIGIN}/artists`, priority: 0.8, changeFrequency: "weekly" },
      { url: `${SITE_ORIGIN}/new`, priority: 0.8, changeFrequency: "daily" },
      { url: `${SITE_ORIGIN}/magazine`, priority: 0.8, changeFrequency: "daily" },
    ];

    const categoryRoutes: MetadataRoute.Sitemap = genres.map((genre: string) => ({
      url: `${SITE_ORIGIN}/categories/${getGenreSlug(genre)}`,
      priority: 0.7,
      changeFrequency: "weekly" as const,
    }));

    return [...staticRoutes, ...categoryRoutes];
  }

  // Magazine article pages
  if (normalizedId === 4) {
    const slugs = await withSoftTimeout(
      "sitemap:getAllPublishedSlugs",
      SITEMAP_QUERY_SOFT_TIMEOUT_MS,
      () => getAllPublishedSlugs(),
    ).catch(() => [] as string[]);
    return slugs.map((slug) => ({
      url: `${SITE_ORIGIN}/magazine/${slug}`,
      priority: 0.8,
      changeFrequency: "monthly" as const,
    }));
  }

  // Artist pages: id 1–3 map to offsets 0, 45k, 90k
  const offset = (normalizedId - 1) * ARTIST_SITEMAP_PAGE_SIZE;
  const slugs = await withSoftTimeout(
    `sitemap:getArtistSlugsForSitemap:${normalizedId}`,
    SITEMAP_QUERY_SOFT_TIMEOUT_MS,
    () => getArtistSlugsForSitemap(offset, ARTIST_SITEMAP_PAGE_SIZE, ARTIST_MIN_VIDEO_COUNT),
  ).catch(() => [] as string[]);

  return slugs.map((slug) => ({
    url: `${SITE_ORIGIN}/artist/${slug}`,
    priority: 0.6,
    changeFrequency: "monthly" as const,
  }));
}
