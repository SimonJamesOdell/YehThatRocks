import { videos as fallbackVideos } from "@/lib/catalog";
import { getArtistSlugsForSitemap, getGenres, getGenreSlug } from "@/lib/catalog-data";
import { AVAILABLE_SITE_VIDEOS_JOIN } from "@/lib/catalog-data-db";
import { buildApprovedVideoPredicate } from "@/lib/catalog-data-internal-helpers";
import { hasDatabaseUrl, normalizeYouTubeVideoId, withSoftTimeout } from "@/lib/catalog-data-utils";
import { prisma } from "@/lib/db";
import { getAllPublishedSlugs } from "@/lib/magazine-data";

export const STATIC_SITEMAP_ID = 0;
export const VIDEO_SITEMAP_PAGE_SIZE = 50_000;
export const SITEMAP_QUERY_SOFT_TIMEOUT_MS = 8_000;
const SITEMAP_RUNTIME_CACHE_TTL_MS = Math.max(
  60_000,
  Math.min(15 * 60_000, Number(process.env.SITEMAP_RUNTIME_CACHE_TTL_MS || "300000")),
);

const ARTIST_STATIC_LIMIT = 2_000;
const MAGAZINE_STATIC_LIMIT = 2_000;
let hasWarnedSeedSitemapFallback = false;
let sitemapShardCountCache: { expiresAt: number; value: number } | null = null;
let sitemapShardCountInFlight: Promise<number> | null = null;
const sitemapEntriesCache = new Map<number, { expiresAt: number; entries: SitemapUrlEntry[] }>();
const sitemapEntriesInFlight = new Map<number, Promise<SitemapUrlEntry[]>>();

export type SitemapUrlEntry = {
  loc: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
};

type VideoSitemapRow = {
  videoId: string | null;
  lastModified: Date | string | null;
};

export function clearSitemapDataCaches() {
  sitemapShardCountCache = null;
  sitemapShardCountInFlight = null;
  sitemapEntriesCache.clear();
  sitemapEntriesInFlight.clear();
}

function warnSeedSitemapFallback(context: "count" | "entries") {
  if (hasWarnedSeedSitemapFallback) {
    return;
  }

  hasWarnedSeedSitemapFallback = true;
  console.warn(
    `[sitemap] using seed fallback (${context}) because DATABASE_URL is unavailable; this is a legacy compatibility path.`,
  );
}

function getSitemapSiteOrigin() {
  return process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://yehthatrocks.com";
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeLastModified(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function buildUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const normalizedPath = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${getSitemapSiteOrigin()}${normalizedPath}`;
}

export function buildSitemapUrlSet(entries: SitemapUrlEntry[]) {
  const urls = entries.map((entry) => {
    const parts = ["  <url>", `    <loc>${xmlEscape(entry.loc)}</loc>`];
    if (entry.lastmod) {
      parts.push(`    <lastmod>${xmlEscape(entry.lastmod)}</lastmod>`);
    }
    if (entry.changefreq) {
      parts.push(`    <changefreq>${entry.changefreq}</changefreq>`);
    }
    if (typeof entry.priority === "number") {
      parts.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
    }
    parts.push("  </url>");
    return parts.join("\n");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

export function buildSitemapIndex(shardIds: number[]) {
  const now = new Date().toISOString();
  const entries = shardIds.map((id) => [
    "  <sitemap>",
    `    <loc>${xmlEscape(buildUrl(`/sitemap/${id}.xml`))}</loc>`,
    `    <lastmod>${now}</lastmod>`,
    "  </sitemap>",
  ].join("\n"));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    "</sitemapindex>",
    "",
  ].join("\n");
}

export async function getVideoSitemapShardCount() {
  if (!hasDatabaseUrl()) {
    warnSeedSitemapFallback("count");
    return Math.max(1, Math.ceil(fallbackVideos.length / VIDEO_SITEMAP_PAGE_SIZE));
  }

  const now = Date.now();
  if (sitemapShardCountCache && sitemapShardCountCache.expiresAt > now) {
    return sitemapShardCountCache.value;
  }

  if (sitemapShardCountInFlight) {
    return sitemapShardCountInFlight;
  }

  sitemapShardCountInFlight = (async () => {
    const rows = await withSoftTimeout(
      "sitemap:countVideoUrls",
      SITEMAP_QUERY_SOFT_TIMEOUT_MS,
      () => prisma.$queryRawUnsafe<Array<{ total: number | bigint | null }>>(
        `
          SELECT COUNT(*) AS total
          FROM videos v
          ${AVAILABLE_SITE_VIDEOS_JOIN}
          WHERE ${buildApprovedVideoPredicate("v")}
            AND v.videoId IS NOT NULL
            AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
        `,
      ),
    ).catch(() => []);

    const total = Number(rows[0]?.total ?? 0);
    const shardCount = Math.max(1, Math.ceil((Number.isFinite(total) ? total : 0) / VIDEO_SITEMAP_PAGE_SIZE));

    sitemapShardCountCache = {
      expiresAt: Date.now() + SITEMAP_RUNTIME_CACHE_TTL_MS,
      value: shardCount,
    };

    return shardCount;
  })().finally(() => {
    sitemapShardCountInFlight = null;
  });

  return sitemapShardCountInFlight;
}

export async function getSitemapShardIds() {
  const videoShardCount = await getVideoSitemapShardCount();
  return [
    STATIC_SITEMAP_ID,
    ...Array.from({ length: videoShardCount }, (_, index) => index + 1),
  ];
}

export async function getStaticSitemapEntries(): Promise<SitemapUrlEntry[]> {
  const origin = getSitemapSiteOrigin();
  const staticRoutes: SitemapUrlEntry[] = [
    { loc: origin, priority: 1.0, changefreq: "daily" },
    { loc: buildUrl("/categories"), priority: 0.9, changefreq: "weekly" },
    { loc: buildUrl("/top100"), priority: 0.9, changefreq: "weekly" },
    { loc: buildUrl("/artists"), priority: 0.8, changefreq: "weekly" },
    { loc: buildUrl("/new"), priority: 0.8, changefreq: "daily" },
    { loc: buildUrl("/magazine"), priority: 0.8, changefreq: "daily" },
  ];

  const genres = await withSoftTimeout(
    "sitemap:getGenres",
    SITEMAP_QUERY_SOFT_TIMEOUT_MS,
    () => getGenres(),
  ).catch(() => [] as string[]);

  const categories = genres.map((genre) => ({
    loc: buildUrl(`/categories/${getGenreSlug(genre)}`),
    priority: 0.7,
    changefreq: "weekly" as const,
  }));

  const magazineSlugs = await withSoftTimeout(
    "sitemap:getAllPublishedSlugs",
    SITEMAP_QUERY_SOFT_TIMEOUT_MS,
    () => getAllPublishedSlugs(),
  ).catch(() => [] as string[]);

  const magazine = magazineSlugs.slice(0, MAGAZINE_STATIC_LIMIT).map((slug) => ({
    loc: buildUrl(`/magazine/${slug}`),
    priority: 0.8,
    changefreq: "monthly" as const,
  }));

  const artistSlugs = await withSoftTimeout(
    "sitemap:getArtistSlugsForStaticShard",
    SITEMAP_QUERY_SOFT_TIMEOUT_MS,
    () => getArtistSlugsForSitemap(0, ARTIST_STATIC_LIMIT, 2),
  ).catch(() => [] as string[]);

  const artists = artistSlugs.map((slug) => ({
    loc: buildUrl(`/artist/${slug}`),
    priority: 0.6,
    changefreq: "monthly" as const,
  }));

  return [...staticRoutes, ...categories, ...magazine, ...artists];
}

export async function getVideoSitemapEntries(shardId: number): Promise<SitemapUrlEntry[]> {
  if (shardId < 1 || !Number.isInteger(shardId)) {
    return [];
  }

  const offset = (shardId - 1) * VIDEO_SITEMAP_PAGE_SIZE;

  if (!hasDatabaseUrl()) {
    warnSeedSitemapFallback("entries");
    return fallbackVideos
      .slice(offset, offset + VIDEO_SITEMAP_PAGE_SIZE)
      .map((video) => normalizeYouTubeVideoId(video.id))
      .filter((videoId): videoId is string => Boolean(videoId))
      .map((videoId) => ({
        loc: buildUrl(`/?v=${encodeURIComponent(videoId)}`),
        priority: 0.7,
        changefreq: "monthly" as const,
      }));
  }

  const now = Date.now();
  const cachedEntries = sitemapEntriesCache.get(shardId);
  if (cachedEntries && cachedEntries.expiresAt > now) {
    return cachedEntries.entries;
  }

  const inFlightEntries = sitemapEntriesInFlight.get(shardId);
  if (inFlightEntries) {
    return inFlightEntries;
  }

  const pendingEntries = (async () => {
    const rows = await withSoftTimeout(
      `sitemap:getVideoShard:${shardId}`,
      SITEMAP_QUERY_SOFT_TIMEOUT_MS,
      () => prisma.$queryRawUnsafe<VideoSitemapRow[]>(
        `
          SELECT
            v.videoId AS videoId,
            COALESCE(v.updated_at, v.approved_at, v.created_at) AS lastModified
          FROM videos v
          ${AVAILABLE_SITE_VIDEOS_JOIN}
          WHERE ${buildApprovedVideoPredicate("v")}
            AND v.videoId IS NOT NULL
            AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
          ORDER BY v.id ASC
          LIMIT ? OFFSET ?
        `,
        VIDEO_SITEMAP_PAGE_SIZE,
        offset,
      ),
    ).catch(() => []);

    const entries: SitemapUrlEntry[] = [];

    for (const row of rows) {
      const videoId = normalizeYouTubeVideoId(row.videoId);
      if (!videoId) {
        continue;
      }

      entries.push({
        loc: buildUrl(`/?v=${encodeURIComponent(videoId)}`),
        lastmod: normalizeLastModified(row.lastModified),
        priority: 0.7,
        changefreq: "monthly",
      });
    }

    sitemapEntriesCache.set(shardId, {
      expiresAt: Date.now() + SITEMAP_RUNTIME_CACHE_TTL_MS,
      entries,
    });

    return entries;
  })();

  sitemapEntriesInFlight.set(shardId, pendingEntries);

  try {
    return await pendingEntries;
  } finally {
    if (sitemapEntriesInFlight.get(shardId) === pendingEntries) {
      sitemapEntriesInFlight.delete(shardId);
    }
  }
}

export async function getSitemapEntriesForShard(shardId: number) {
  return shardId === STATIC_SITEMAP_ID
    ? getStaticSitemapEntries()
    : getVideoSitemapEntries(shardId);
}

export function parseSitemapShardId(rawId: string | number | undefined) {
  const raw = String(rawId ?? "").trim().replace(/\.xml$/i, "");
  if (!/^\d+$/.test(raw)) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}