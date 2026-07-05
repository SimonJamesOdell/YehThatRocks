import { prisma } from "@/lib/db";

// ── Types ─────────────────────────────────────────────────────────────────

export type MagazineBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "quote"; text: string; attribution?: string };

export type MagazineArticle = {
  slug: string;
  title: string;
  kicker: string | null;
  deck: string | null;
  artist: string;
  trackName: string | null;  // nullable for non-track articles
  genre: string;
  videoId: string | null;  // nullable for non-track articles
  body: MagazineBlock[];
  seoDescription: string | null;
  seoKeywords: string | null;
  publishedAt: Date;
};

// ── Raw DB row type (snake_case from MySQL) ──────────────────────────────

type RawArticleRow = {
  slug: string;
  title: string;
  kicker: string | null;
  deck: string | null;
  artist: string;
  track_name: string | null;  // nullable for non-track articles
  genre: string;
  video_id: string | null;  // nullable for non-track articles
  body: string;
  seo_description: string | null;
  seo_keywords: string | null;
  published_at: Date;
};

function rowToArticle(row: RawArticleRow): MagazineArticle {
  let body: MagazineBlock[] = [];
  try {
    const parsed = JSON.parse(row.body) as unknown;
    if (Array.isArray(parsed)) {
      body = parsed as MagazineBlock[];
    }
  } catch {
    body = [{ type: "p", text: row.body }];
  }
  return {
    slug: row.slug,
    title: row.title,
    kicker: row.kicker,
    deck: row.deck,
    artist: row.artist,
    trackName: row.track_name,
    genre: row.genre,
    videoId: row.video_id,
    body,
    seoDescription: row.seo_description,
    seoKeywords: row.seo_keywords,
    publishedAt: row.published_at,
  };
}

// ── Seed articles (fallback when DB is unavailable) ───────────────────────

const SEED_ARTICLES: MagazineArticle[] = [
  {
    slug: "knocked-loose-suffocate",
    videoId: "kBBOxFb7oG0",
    title: "Knocked Loose - Suffocate: The Collaboration Nobody Saw Coming",
    kicker: "Hardcore",
    deck: "They made one of the heaviest albums of the decade and then brought in Poppy. This was not a mistake.",
    artist: "Knocked Loose",
    trackName: "Suffocate",
    genre: "Hardcore",
    seoDescription: "Knocked Loose's Suffocate featuring Poppy is the track that broke hardcore into mainstream conversation in 2024. Here's why it works and what Bryan Garris is doing with his voice.",
    seoKeywords: "Knocked Loose, Suffocate, Poppy, You Won't Go Before You're Supposed To, hardcore, Bryan Garris, 2024",
    publishedAt: new Date("2026-05-08"),
    body: [
      { type: "p", text: "You Won't Go Before You're Supposed To came out in May 2024 and it did something hardcore albums rarely do: it got people who don't listen to hardcore talking about hardcore. Not in the usual way where a band softens things and gets crossover play. Knocked Loose got louder and more precise and the conversation followed them there. Suffocate is the track that made this happen at scale." },
      { type: "h2", text: "What Bryan Garris Does" },
      { type: "p", text: "Garris has a specific gift that most hardcore vocalists lack: he controls where the violence lands. His screamed delivery on Suffocate isn't noise being produced at high volume. It's phrasing, and each phrase has a shape. The low end of his range on the verse sections sits under the guitars without fighting them. When he pushes up into the higher register on the chorus it creates a physical sensation that's hard to describe cleanly. You feel it in your chest more than you hear it." },
      { type: "h2", text: "Poppy Is Not a Contrast Device" },
      { type: "p", text: "The obvious read on this collaboration is that Poppy's clean singing was brought in to provide contrast with Garris, to make the heavy parts feel heavier by placing softness next to them. That read is wrong. Her contribution operates as a second voice delivering the same emotional content in a different register. She isn't there to be the pop element that makes this digestible for outsiders. Her sections are just as hostile as Garris's, built from different materials. When the two voices overlap in the final section the effect is genuinely unsettling. That was the point." },
      { type: "h2", text: "The Production" },
      { type: "p", text: "Isaac Hale produced the record and he mixed it at the kind of volume where individual instruments stop being separable. Suffocate is dense in a way that rewards headphones. The guitars are tuned and timed to make room for the vocal and nothing else. The drum performance from Kevin Kaine is locked to a degree that makes the chaos feel deliberate rather than accidental. The snare sound on this record is going to be studied in fifteen years the same way people still talk about the Bonham kick drum sound from 1971." },
      { type: "h2", text: "Why This Matters in 2026" },
      { type: "p", text: "Hardcore has been the most productive corner of heavy music for the last five years. Knocked Loose are the reason the genre has a mainstream conversation at all right now. Suffocate is the track that crossed into normal people's playlists and it did it without apologizing for being what it is. The whole album is on Yeh. Start here and then go straight into the rest of it." },
    ],
  },
];

// ── DB access ─────────────────────────────────────────────────────────────

async function queryArticles(limit: number, offset = 0): Promise<MagazineArticle[]> {
  const rows = await prisma.$queryRaw<RawArticleRow[]>`
    SELECT slug, title, kicker, deck, artist, track_name, genre, video_id,
           body, seo_description, seo_keywords, published_at
    FROM magazine_articles
    WHERE status = 'published'
    ORDER BY published_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return rows.map(rowToArticle);
}

async function queryArticleCount(): Promise<number> {
  const rows = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM magazine_articles WHERE status = 'published'
  `;
  return Number(rows[0]?.count ?? 0);
}

async function queryArticleBySlug(slug: string): Promise<MagazineArticle | null> {
  const rows = await prisma.$queryRaw<RawArticleRow[]>`
    SELECT slug, title, kicker, deck, artist, track_name, genre, video_id,
           body, seo_description, seo_keywords, published_at
    FROM magazine_articles
    WHERE slug = ${slug} AND status = 'published'
    LIMIT 1
  `;
  return rows[0] ? rowToArticle(rows[0]) : null;
}

async function querySlugs(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ slug: string }[]>`
    SELECT slug FROM magazine_articles
    WHERE status = 'published'
    ORDER BY published_at DESC
  `;
  return rows.map((r: { slug: string }) => r.slug);
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Returns published articles, newest first, with a thumbnail preflight filter.
 * Probes the hqdefault thumbnail for each candidate — hqdefault reliably returns
 * 404 for deleted/private videos, unlike mqdefault which always returns 200.
 * Over-fetches by a small buffer so filtering doesn't reduce the result below limit.
 * Falls back to seed articles if the DB is unavailable or all candidates fail.
 */
export async function getPublishedArticles(limit = 20): Promise<MagazineArticle[]> {
  try {
    // Over-fetch to buffer for articles that fail the thumbnail health check.
    const fetchLimit = Math.min(limit + 6, 30);
    const rows = await queryArticles(fetchLimit);
    if (rows.length === 0) return SEED_ARTICLES.slice(0, limit);

    // Run hqdefault HEAD checks in parallel for all candidates that have videos.
    // Non-video articles (videoId = null) are considered healthy by default.
    const checked = await Promise.all(
      rows.map(async (article) => ({
        article,
        ok: article.videoId ? await checkHqThumbnailHealth(article.videoId) : true,
      })),
    );
    const healthy = checked.filter((r) => r.ok).map((r) => r.article).slice(0, limit);
    return healthy.length > 0 ? healthy : SEED_ARTICLES.slice(0, limit);
  } catch {
    return SEED_ARTICLES.slice(0, limit);
  }
}

/**
 * Paginated variant of getPublishedArticles. Accepts an offset and returns
 * both the matching articles and a hasMore flag for infinite scroll.
 */
export async function getPublishedArticlesPaginated(
  limit: number,
  offset: number,
): Promise<{ articles: MagazineArticle[]; hasMore: boolean; total: number }> {
  try {
    const [rows, total] = await Promise.all([
      queryArticles(limit + 6, offset), // over-fetch for thumbnail filtering
      queryArticleCount(),
    ]);
    if (rows.length === 0) {
      return { articles: [], hasMore: false, total };
    }

    // Run hqdefault HEAD checks in parallel
    const checked = await Promise.all(
      rows.map(async (article) => ({
        article,
        ok: article.videoId ? await checkHqThumbnailHealth(article.videoId) : true,
      })),
    );
    const healthy = checked.filter((r) => r.ok).map((r) => r.article).slice(0, limit);
    const hasMore = offset + healthy.length < total;
    return { articles: healthy, hasMore, total };
  } catch {
    // On error, use seed articles but respect offset
    const sliced = SEED_ARTICLES.slice(offset, offset + limit);
    return { articles: sliced, hasMore: offset + sliced.length < SEED_ARTICLES.length, total: SEED_ARTICLES.length };
  }
}

/**
 * Returns a single published article by slug.
 * Falls back to the matching seed article if the DB is unavailable.
 */
export async function getArticleBySlug(slug: string): Promise<MagazineArticle | null> {
  try {
    const row = await queryArticleBySlug(slug);
    if (row) return row;
  } catch {
    // fall through to seed
  }
  return SEED_ARTICLES.find((a) => a.slug === slug) ?? null;
}

/**
 * Returns all published article slugs (for generateStaticParams).
 * Falls back to seed slugs if the DB is unavailable.
 */
export async function getAllPublishedSlugs(): Promise<string[]> {
  try {
    const slugs = await querySlugs();
    return slugs.length > 0 ? slugs : SEED_ARTICLES.map((a) => a.slug);
  } catch {
    return SEED_ARTICLES.map((a) => a.slug);
  }
}

/** The seed articles — used by the left rail and auth gate as static previews. */
export { SEED_ARTICLES };

// ── Thumbnail health check ────────────────────────────────────────────────

// Per-process cache: videoId → { ok, checkedAt }. 30-min TTL.
// hqdefault reliably returns 404 for deleted/private/unavailable videos;
// mqdefault (and lower) always returns 200 with a generic placeholder.
const _thumbHealthCache = new Map<string, { ok: boolean; at: number }>();
const THUMB_HEALTH_TTL_MS = 30 * 60 * 1000;

/**
 * Performs a HEAD request to YouTube's hqdefault thumbnail for the given videoId.
 * hqdefault returns 404 for deleted/private/unavailable videos.
 * If the HEAD fails for a transient reason (network error), returns true
 * so we don't accidentally prune good articles.
 */
async function checkHqThumbnailHealth(videoId: string): Promise<boolean> {
  const now = Date.now();
  const cached = _thumbHealthCache.get(videoId);
  if (cached && (now - cached.at) < THUMB_HEALTH_TTL_MS) {
    return cached.ok;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`, {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const ok = res.ok;
    _thumbHealthCache.set(videoId, { ok, at: now });
    return ok;
  } catch {
    // Network error — assume healthy (don't prune good articles on transient issues)
    _thumbHealthCache.set(videoId, { ok: true, at: now });
    return true;
  }
}

/**
 * Prunes articles whose YouTube video is no longer available.
 * Called by the /api/magazine/latest route handler. Returns the number removed.
 */
export async function pruneUnavailableArticles(): Promise<number> {
  try {
    const slugs = await querySlugs();
    if (slugs.length === 0) return 0;

    // Check all articles in parallel (capped at 20 concurrent)
    const BATCH = 20;
    let removed = 0;
    for (let i = 0; i < slugs.length; i += BATCH) {
      const batch = slugs.slice(i, i + BATCH);
      const checks = await Promise.all(
        batch.map(async (slug) => {
          const article = await queryArticleBySlug(slug);
          if (!article || !article.videoId) return null;
          const ok = await checkHqThumbnailHealth(article.videoId);
          return ok ? null : slug;
        }),
      );
      const toRemove = checks.filter(Boolean) as string[];
      for (const slug of toRemove) {
        await prisma.$executeRaw`
          UPDATE magazine_articles SET status = 'draft' WHERE slug = ${slug}
        `;
        removed++;
      }
    }
    return removed;
  } catch {
    return 0;
  }
}
