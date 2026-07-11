#!/usr/bin/env node

/**
 * Artist outreach script.
 *
 * Finds artists with wiki pages in the database who might have contact
 * information discoverable online. Generates personalised outreach email
 * templates for each.
 *
 * The workflow:
 *   1. Query artists with wiki content (highest-value targets)
 *   2. For each artist, generate an outreach email template
 *   3. Output a CSV that you can review and send manually
 *
 * The script does NOT auto-send emails — that's a deliberate choice.
 * Artist outreach should be reviewed by a human before sending.
 *
 * Usage:
 *   node scripts/artist-outreach.js                     (list all candidates)
 *   node scripts/artist-outreach.js --limit 10          (top 10)
 *   node scripts/artist-outreach.js --genre "progressive metal"
 *   node scripts/artist-outreach.js --output outreach.csv
 *
 * Phase 6.1 — Artist outreach (TRAFFIC_ROADMAP.md)
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
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
// Candidate queries
// ---------------------------------------------------------------------------

/**
 * Fetch artists with wiki pages, ordered by video count (popularity).
 */
async function getArtistsWithWiki(prisma, limit, genreFilter) {
  let genreClause = "";
  const params = [];

  if (genreFilter) {
    genreClause = "AND (a.genre1 = ? OR a.genre2 = ?)";
    params.push(genreFilter, genreFilter);
  }

  params.push(limit || 50);

  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        a.id,
        a.artist AS name,
        a.artist_name_norm AS nameNorm,
        a.country,
        a.genre1,
        a.genre2,
        a.wiki_summary AS wikiSummary,
        a.wiki_content AS wikiContent,
        a.musicbrainz_id AS musicbrainzId,
        COUNT(av.video_id) AS videoCount,
        SUM(COALESCE(v.favourited, 0)) AS totalFavs
      FROM artists a
      INNER JOIN artist_videos av ON av.artist_id = a.id
      INNER JOIN videos v ON v.id = av.video_id AND v.approved = 1
      INNER JOIN site_videos sv ON sv.video_id = v.id AND sv.status = 'available'
      WHERE a.wiki_summary IS NOT NULL
        AND LENGTH(TRIM(a.wiki_summary)) > 50
        ${genreClause}
      GROUP BY a.id
      ORDER BY totalFavs DESC, videoCount DESC
      LIMIT ?
    `,
    ...params,
  );

  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name || "").trim(),
    nameNorm: String(row.nameNorm || "").trim(),
    country: String(row.country || "").trim(),
    genre1: String(row.genre1 || "").trim(),
    genre2: String(row.genre2 || "").trim(),
    wikiSummary: String(row.wikiSummary || "").trim(),
    musicbrainzId: String(row.musicbrainzId || "").trim(),
    videoCount: toSafeNumber(row.videoCount, 0),
    totalFavs: toSafeNumber(row.totalFavs, 0),
  }));
}

// ---------------------------------------------------------------------------
// Email template generator
// ---------------------------------------------------------------------------

const EMAIL_TEMPLATES = [
  // Template A: Friendly introduction
  {
    id: "intro",
    weight: 0.5,
    subject: (artist) => `${artist.name} on YehThatRocks`,
    body: (artist) => `Hi ${artist.name} team,

I run YehThatRocks (${APP_URL}), a rock and metal music discovery site. We have a page about ${artist.name} with ${artist.videoCount} videos and a wiki excerpt — and it's getting attention from fans searching for ${artist.genre1 || "rock/metal"} music.

I wanted to let you know in case you'd like to add anything — corrections, bio updates, links to your official site or social media. Happy to include whatever you'd like.

Your page: ${APP_URL}/artist/${encodeURIComponent(artist.nameNorm || artist.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}

No obligation at all — just thought you should know people are discovering your music here.

Cheers,
Simon
YehThatRocks`,
  },

  // Template B: Share request
  {
    id: "share",
    weight: 0.3,
    subject: (artist) => `Your page on YehThatRocks — ${artist.name}`,
    body: (artist) => `Hi there,

I built a page for ${artist.name} on YehThatRocks, a rock and metal discovery platform. It features ${artist.videoCount} of your videos${artist.totalFavs > 0 ? ` and has been favourited ${artist.totalFavs} times by our community` : ""}.

If you think your fans would enjoy it, feel free to share the link — or let me know if anything needs updating. The wiki section pulls from MusicBrainz and Wikipedia, but I'm always happy to correct or expand it.

Your page: ${APP_URL}/artist/${encodeURIComponent(artist.nameNorm || artist.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}

Thanks for making great music.

Simon
YehThatRocks`,
  },

  // Template C: Discovery stats
  {
    id: "discovery",
    weight: 0.2,
    subject: (artist) => `People are discovering ${artist.name} on YehThatRocks`,
    body: (artist) => `Hi ${artist.name} team,

Quick heads-up: ${artist.name} has a growing presence on YehThatRocks, a music discovery platform focused on rock and metal. We currently have ${artist.videoCount} of your videos, and they're being discovered by fans browsing ${artist.genre1 || "the genre"}.

Your artist page: ${APP_URL}/artist/${encodeURIComponent(artist.nameNorm || artist.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}

If you'd like to add official links, correct any info, or just say hi — I'm all ears. No pressure, just wanted you to know you're being found here.

Simon
YehThatRocks`,
  },
];

/**
 * Pick a weighted random template.
 */
function pickTemplate(artist) {
  const totalWeight = EMAIL_TEMPLATES.reduce((sum, t) => sum + t.weight, 0);
  let cursor = Math.random() * totalWeight;

  for (const template of EMAIL_TEMPLATES) {
    cursor -= template.weight;
    if (cursor <= 0) {
      return {
        subject: template.subject(artist),
        body: template.body(artist),
        templateId: template.id,
      };
    }
  }

  const fallback = EMAIL_TEMPLATES[0];
  return {
    subject: fallback.subject(artist),
    body: fallback.body(artist),
    templateId: fallback.id,
  };
}

// ---------------------------------------------------------------------------
// CSV output
// ---------------------------------------------------------------------------

function escapeCsv(value) {
  if (!value) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function generateCsv(artists) {
  const headers = [
    "artist_name",
    "genre",
    "country",
    "video_count",
    "total_favs",
    "page_url",
    "email_subject",
    "email_body",
    "template_id",
  ];

  const lines = [headers.join(",")];

  for (const artist of artists) {
    const pageUrl = `${APP_URL}/artist/${encodeURIComponent(artist.nameNorm || artist.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}`;
    const email = pickTemplate(artist);

    lines.push([
      escapeCsv(artist.name),
      escapeCsv(artist.genre1),
      escapeCsv(artist.country),
      String(artist.videoCount),
      String(artist.totalFavs),
      escapeCsv(pageUrl),
      escapeCsv(email.subject),
      escapeCsv(email.body),
      escapeCsv(email.templateId),
    ].join(","));
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? toPositiveInt(args[limitIdx + 1], 50) : 50;
  const genreIdx = args.indexOf("--genre");
  const genreFilter = genreIdx >= 0 ? args[genreIdx + 1] : null;
  const outputIdx = args.indexOf("--output");
  const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : null;

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

  // ── Fetch candidates ──────────────────────────────────────────────────
  const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });

  let artists;
  try {
    artists = await getArtistsWithWiki(prisma, limit, genreFilter);
  } finally {
    await prisma.$disconnect();
  }

  if (artists.length === 0) {
    console.log("[artist-outreach] No artists with wiki pages found.");
    return;
  }

  console.log(`[artist-outreach] Found ${artists.length} artists with wiki pages.`);

  // ── Generate outreach data ────────────────────────────────────────────
  for (const artist of artists.slice(0, 5)) {
    const pageUrl = `${APP_URL}/artist/${encodeURIComponent(artist.nameNorm || artist.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}`;
    console.log(`\n  ${artist.name}  [${artist.genre1}]  ${artist.videoCount} videos  ❤️ ${artist.totalFavs}`);
    console.log(`  ${pageUrl}`);
  }

  // ── Output ────────────────────────────────────────────────────────────
  if (outputPath) {
    const csv = generateCsv(artists);
    ensureDirFor(outputPath);
    fs.writeFileSync(outputPath, csv);
    console.log(`\n[artist-outreach] CSV written to: ${outputPath} (${artists.length} rows)`);
  } else {
    console.log(`\n[artist-outreach] Use --output outreach.csv to generate a CSV with email templates.`);
    console.log(`[artist-outreach] Review before sending — these are real artists.`);
  }
}

main().catch((error) => {
  console.error("[artist-outreach] Failed:", error?.message || error);
  process.exit(1);
});
