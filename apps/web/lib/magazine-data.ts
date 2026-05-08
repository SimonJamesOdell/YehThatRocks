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
  trackName: string;
  genre: string;
  videoId: string;
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
  track_name: string;
  genre: string;
  video_id: string;
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

async function queryArticles(limit: number): Promise<MagazineArticle[]> {
  const rows = await prisma.$queryRaw<RawArticleRow[]>`
    SELECT slug, title, kicker, deck, artist, track_name, genre, video_id,
           body, seo_description, seo_keywords, published_at
    FROM magazine_articles
    WHERE status = 'published'
    ORDER BY published_at DESC
    LIMIT ${limit}
  `;
  return rows.map(rowToArticle);
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
  return rows.map((r) => r.slug);
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Returns published articles, newest first.
 * Falls back to seed articles if the DB is unavailable or the table is empty.
 */
export async function getPublishedArticles(limit = 20): Promise<MagazineArticle[]> {
  try {
    const rows = await queryArticles(limit);
    return rows.length > 0 ? rows : SEED_ARTICLES.slice(0, limit);
  } catch {
    return SEED_ARTICLES.slice(0, limit);
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

// ── Video availability preflight ──────────────────────────────────────────

/**
 * Checks whether a YouTube video is still publicly available via the oEmbed endpoint.
 * Returns true (available), false (definitively unavailable), null (network/timeout — unknown).
 */
async function checkYouTubeOEmbed(videoId: string): Promise<boolean | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D${encodeURIComponent(videoId)}&format=json`,
      { signal: controller.signal, cache: "no-store" },
    );
    clearTimeout(timer);
    if (res.status === 200) return true;
    if (res.status >= 400 && res.status < 500) return false;
    return null;
  } catch {
    return null;
  }
}

// In-process cooldown so the preflight doesn't run on every listing request.
let _lastPruneMs = 0;
const PRUNE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

/**
 * Checks all published articles' videos via the YouTube oEmbed API and deletes
 * any article whose video is definitively no longer available.
 * Rate-limited to once per hour within the same server process.
 * Returns the number of articles deleted.
 */
export async function pruneUnavailableArticles(): Promise<number> {
  const now = Date.now();
  if (now - _lastPruneMs < PRUNE_COOLDOWN_MS) return 0;
  _lastPruneMs = now;

  const rows = await prisma.$queryRaw<{ id: number; videoId: string }[]>`
    SELECT id, video_id AS videoId FROM magazine_articles WHERE status = 'published'
  `;
  if (rows.length === 0) return 0;

  const checks = await Promise.allSettled(
    rows.map(async (row) => ({ id: row.id, available: await checkYouTubeOEmbed(row.videoId) })),
  );

  const toDelete = checks
    .filter(
      (r): r is PromiseFulfilledResult<{ id: number; available: boolean | null }> =>
        r.status === "fulfilled",
    )
    .filter((r) => r.value.available === false)
    .map((r) => r.value.id);

  if (toDelete.length === 0) return 0;

  await prisma.magazineArticle.deleteMany({ where: { id: { in: toDelete } } });
  return toDelete.length;
}
