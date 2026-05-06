import type { MetadataRoute } from "next";

import { getArtistSlugsForSitemap, getGenres, getGenreSlug } from "@/lib/catalog-data";

const SITE_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") ||
  "https://yehthatrocks.com";

// id=0: static pages + genres (~160 entries)
// id=1–3: artist pages with 2+ videos, 45k per page (covers up to 135k qualifying artists)
const ARTIST_SITEMAP_PAGE_SIZE = 45_000;
const ARTIST_SITEMAP_PAGES = 3;
const ARTIST_MIN_VIDEO_COUNT = 2;

export async function generateSitemaps() {
  return [
    { id: 0 },
    ...Array.from({ length: ARTIST_SITEMAP_PAGES }, (_, i) => ({ id: i + 1 })),
  ];
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  if (id === 0) {
    const genres = await getGenres().catch(() => [] as string[]);

    const staticRoutes: MetadataRoute.Sitemap = [
      { url: SITE_ORIGIN, priority: 1.0, changeFrequency: "daily" },
      { url: `${SITE_ORIGIN}/categories`, priority: 0.9, changeFrequency: "weekly" },
      { url: `${SITE_ORIGIN}/top100`, priority: 0.9, changeFrequency: "weekly" },
      { url: `${SITE_ORIGIN}/artists`, priority: 0.8, changeFrequency: "weekly" },
      { url: `${SITE_ORIGIN}/new`, priority: 0.8, changeFrequency: "daily" },
    ];

    const categoryRoutes: MetadataRoute.Sitemap = genres.map((genre) => ({
      url: `${SITE_ORIGIN}/categories/${getGenreSlug(genre)}`,
      priority: 0.7,
      changeFrequency: "weekly" as const,
    }));

    return [...staticRoutes, ...categoryRoutes];
  }

  // Artist pages: id 1–4 map to offsets 0, 45k, 90k, 135k
  const offset = (id - 1) * ARTIST_SITEMAP_PAGE_SIZE;
  const slugs = await getArtistSlugsForSitemap(offset, ARTIST_SITEMAP_PAGE_SIZE, ARTIST_MIN_VIDEO_COUNT).catch(() => [] as string[]);

  return slugs.map((slug) => ({
    url: `${SITE_ORIGIN}/artist/${slug}`,
    priority: 0.6,
    changeFrequency: "monthly" as const,
  }));
}
