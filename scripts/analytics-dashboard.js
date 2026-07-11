#!/usr/bin/env node

/**
 * Analytics and optimization scripts (Phase 8).
 *
 * Three functions in one script:
 *   1. Traffic dashboard — compile stats from DB (no external API needed)
 *   2. A/B test share copy — rotate message templates for social posts
 *   3. Search Console query mining — find ranking opportunities
 *
 * Usage:
 *   node scripts/analytics-dashboard.js --dashboard       (traffic stats)
 *   node scripts/analytics-dashboard.js --ab-test         (generate copy variants)
 *   node scripts/analytics-dashboard.js --ranking-gaps     (find keyword gaps)
 *   node scripts/analytics-dashboard.js --all              (everything)
 *
 * Phase 8.2–8.4 — Analytics & Feedback Loops (TRAFFIC_ROADMAP.md)
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const https = require("node:https");
const { PrismaClient } = require("@prisma/client");
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");

// Load env before anything else
try { require("dotenv").config({ path: path.resolve(process.cwd(), "apps/web/.env.local") }); } catch {}
try { require("dotenv").config(); } catch {}

const {
  loadEnv,
  toPositiveInt,
  toSafeNumber,
  ensureDirFor,
} = require("./lib/social-share-utils");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const APP_URL = (process.env.APP_URL || "https://yehthatrocks.com").trim().replace(/\/$/, "");

// ---------------------------------------------------------------------------
// 8.2 — Traffic dashboard
// ---------------------------------------------------------------------------

/**
 * Compile traffic-relevant stats from the database.
 * No external API needed — uses internal data.
 */
async function generateDashboard(prisma) {
  console.log("[analytics] ═══ Traffic Dashboard ═══\n");

  // Total approved videos
  const [{ total }] = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*) AS total FROM videos WHERE approved = 1",
  );
  console.log(`  Approved videos:         ${total}`);

  // Available videos
  const [{ available }] = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*) AS available FROM site_videos WHERE status = 'available'",
  );
  console.log(`  Available (playable):    ${available}`);

  // Total artists
  const [{ artists }] = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*) AS artists FROM artists",
  );
  console.log(`  Artists indexed:         ${artists}`);

  // Total favourites
  const [{ favs }] = await prisma.$queryRawUnsafe(
    "SELECT COALESCE(SUM(favourited), 0) AS favs FROM videos WHERE approved = 1",
  );
  console.log(`  Total favourites:        ${favs}`);

  // Published magazine articles
  const [{ articles }] = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*) AS articles FROM magazine_articles WHERE status = 'published'",
  );
  console.log(`  Magazine articles:       ${articles}`);

  // Top 10 videos by favourites
  const topVideos = await prisma.$queryRawUnsafe(
    `
      SELECT
        COALESCE(NULLIF(TRIM(v.parsedArtist), ''), 'Unknown') AS artist,
        COALESCE(NULLIF(TRIM(v.parsedTrack), ''), NULLIF(TRIM(v.title), ''), 'Unknown') AS title,
        v.favourited AS favs,
        v.videoId
      FROM videos v
      WHERE v.approved = 1
      ORDER BY v.favourited DESC
      LIMIT 10
    `,
  );

  console.log("\n  Top 10 Videos:");
  for (const v of topVideos) {
    console.log(`    ❤️ ${String(v.favs).padStart(4)}  ${v.artist} — ${v.title}`);
  }

  // Top 10 genres by video count
  const topGenres = await prisma.$queryRawUnsafe(
    `
      SELECT
        COALESCE(NULLIF(TRIM(v.genre_norm), ''), 'Unclassified') AS genre,
        COUNT(*) AS count,
        COALESCE(SUM(v.favourited), 0) AS totalFavs
      FROM videos v
      WHERE v.approved = 1
      GROUP BY v.genre_norm
      ORDER BY count DESC
      LIMIT 10
    `,
  );

  console.log("\n  Top 10 Genres:");
  for (const g of topGenres) {
    console.log(`    ${String(g.count).padStart(5)} videos  ${g.genre}  (${g.totalFavs} favs)`);
  }

  // New videos this week
  const [{ newThisWeek }] = await prisma.$queryRawUnsafe(
    `
      SELECT COUNT(*) AS newThisWeek
      FROM videos
      WHERE approved = 1 AND createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    `,
  );
  console.log(`\n  New this week:           ${newThisWeek}`);

  // Genre coverage
  const [{ genreCount }] = await prisma.$queryRawUnsafe(
    "SELECT COUNT(DISTINCT genre_norm) AS genreCount FROM videos WHERE approved = 1 AND genre_norm IS NOT NULL",
  );
  console.log(`  Genre coverage:           ${genreCount} genres`);

  console.log("\n[analytics] Dashboard complete.");
}

// ---------------------------------------------------------------------------
// 8.3 — A/B test share copy
// ---------------------------------------------------------------------------

/**
 * Generate multiple message templates for social media posts.
 * Rotate through templates and track which ones are used.
 */
const SHARE_TEMPLATES = [
  {
    id: "discovery",
    text: (artist, title, genre) => `Just discovered ${artist} — ${title} [${genre}] 🔥`,
    weight: 0.30,
  },
  {
    id: "new_on_ytr",
    text: (artist, title, genre) => `New on YehThatRocks: ${artist} — ${title} [${genre}]`,
    weight: 0.25,
  },
  {
    id: "favourited",
    text: (artist, title, genre) => `${artist} — ${title} [${genre}] — rocking the charts on YehThatRocks 🎸`,
    weight: 0.20,
  },
  {
    id: "question",
    text: (artist, title, genre) => `Have you heard ${artist}'s "${title}"? [${genre}] — now playing on YehThatRocks`,
    weight: 0.15,
  },
  {
    id: "genre_spotlight",
    text: (artist, title, genre) => `${genre} spotlight: ${artist} — ${title} 🤘`,
    weight: 0.10,
  },
];

function pickAbTemplate(artist, title, genre) {
  const statePath = path.resolve(
    process.cwd(),
    process.env.AB_TEST_STATE_PATH || "logs/ab-test-state.json",
  );

  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    state = { counts: {}, lastUsed: null };
  }

  const totalWeight = SHARE_TEMPLATES.reduce((sum, t) => sum + t.weight, 0);
  let cursor = Math.random() * totalWeight;

  for (const template of SHARE_TEMPLATES) {
    cursor -= template.weight;
    if (cursor <= 0) {
      state.counts[template.id] = (state.counts[template.id] || 0) + 1;
      state.lastUsed = template.id;
      ensureDirFor(statePath);
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
      return template.text(artist, title, genre);
    }
  }

  return SHARE_TEMPLATES[0].text(artist, title, genre);
}

function generateAbTestReport() {
  const statePath = path.resolve(
    process.cwd(),
    process.env.AB_TEST_STATE_PATH || "logs/ab-test-state.json",
  );

  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    console.log("[analytics] No A/B test data yet. Run social posts to collect data.");
    return;
  }

  console.log("[analytics] ═══ A/B Test Report ═══\n");
  console.log("Template usage counts:");

  const total = Object.values(state.counts).reduce((a, b) => a + b, 0);
  for (const template of SHARE_TEMPLATES) {
    const count = state.counts[template.id] || 0;
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";
    const bar = "█".repeat(Math.round(count / Math.max(1, total) * 20));
    console.log(`  ${template.id.padEnd(18)} ${String(count).padStart(4)} (${pct}%) ${bar}`);
  }

  console.log(`\n  Total posts tracked: ${total}`);
  console.log(`  Last template used:  ${state.lastUsed || "none"}`);
  console.log("\n[analytics] Track engagement (clicks, likes) per template to optimize.");
}

// ---------------------------------------------------------------------------
// 8.4 — Search Console query mining
// ---------------------------------------------------------------------------

/**
 * Find potential ranking opportunities from internal data.
 *
 * Without Search Console API access, we use heuristics:
 *   - Pages with high-quality content but low traffic potential
 *   - Long-tail keyword opportunities from artist/wiki data
 *   - Genre×Year combinations that exist but aren't linked from high-traffic pages
 */
async function findRankingGaps(prisma) {
  console.log("[analytics] ═══ Ranking Gap Analysis ═══\n");

  // Artists with wiki content but no genre×year pages linking to them
  const { rows: orphanedArtists } = await prisma.$queryRawUnsafe(
    `
      SELECT
        a.artist AS name,
        a.genre1,
        a.country,
        LENGTH(a.wiki_summary) AS wikiLen,
        COUNT(av.video_id) AS videoCount
      FROM artists a
      INNER JOIN artist_videos av ON av.artist_id = a.id
      WHERE a.wiki_summary IS NOT NULL
        AND LENGTH(TRIM(a.wiki_summary)) > 300
        AND a.genre1 IS NOT NULL
        AND a.country IS NOT NULL
      GROUP BY a.id
      HAVING videoCount >= 5
      ORDER BY wikiLen DESC
      LIMIT 20
    `,
  ).then((r) => ({ rows: r }));

  console.log("Artists with strong wiki content (ranking potential):");
  for (const a of orphanedArtists.slice(0, 10)) {
    const kw = `${a.name} ${a.genre1} music`;
    console.log(`  ${a.name} [${a.genre1}, ${a.country}] — ${a.videoCount} videos, ${a.wikiLen} wiki chars`);
    console.log(`    Target KW: "${kw}"  →  ${APP_URL}/artist/${encodeURIComponent(String(a.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"))}`);
  }

  // Genre combos with high content but no dedicated landing page
  console.log("\nLong-tail keyword opportunities:");
  const genreCombos = [
    { kw: "best progressive metal albums", page: "/best-of/progressive-metal/2024" },
    { kw: "new rock music videos", page: "/new" },
    { kw: "underground death metal bands", page: "/categories/death-metal" },
    { kw: "classic rock songs", page: "/decade/1970s" },
    { kw: "heavy metal workout playlist", page: "/top100" },
    { kw: "black metal bands from Norway", page: "/artist" },
    { kw: "metal bands similar to Opeth", page: "/artist/opeth/similar" },
    { kw: "best metal of the 2000s", page: "/decade/2000s" },
    { kw: "doom metal recommendations", page: "/categories/doom-metal" },
    { kw: "rock music discovery platform", page: "/" },
  ];

  for (const combo of genreCombos) {
    console.log(`  "${combo.kw}"  →  ${APP_URL}${combo.page}`);
  }

  console.log("\n[analytics] Use these keywords for title/meta optimization.");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const dashboardMode = args.includes("--dashboard");
  const abTestMode = args.includes("--ab-test");
  const rankingMode = args.includes("--ranking-gaps");
  const allMode = args.includes("--all");

  if (!dashboardMode && !abTestMode && !rankingMode && !allMode) {
    console.log("[analytics] No mode specified. Use --dashboard, --ab-test, --ranking-gaps, or --all.");
    return;
  }

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

  const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });

  try {
    if (dashboardMode || allMode) {
      await generateDashboard(prisma);
    }

    if (abTestMode || allMode) {
      console.log("\n");
      console.log("[analytics] A/B test copy examples:");
      for (let i = 0; i < 3; i++) {
        const copy = pickAbTemplate("Metallica", "Enter Sandman", "Thrash Metal");
        console.log(`  Sample ${i + 1}: ${copy}`);
      }
      console.log();
      generateAbTestReport();
    }

    if (rankingMode || allMode) {
      console.log("\n");
      await findRankingGaps(prisma);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[analytics] Failed:", error?.message || error);
  process.exit(1);
});
