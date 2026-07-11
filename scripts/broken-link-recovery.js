#!/usr/bin/env node

/**
 * Broken link recovery and link-building opportunity finder.
 *
 * Two modes:
 *   1. Internal scan — crawl your own site for broken internal links
 *      (pages referencing deleted artists, missing magazine articles, etc.)
 *   2. External opportunity scan — query the DB for artists/pages that
 *      could replace broken links on external rock/metal blogs
 *
 * The external scan is semi-automated: it generates a list of target
 * pages and their replacement URLs for manual review.
 *
 * Usage:
 *   node scripts/broken-link-recovery.js --internal         (scan own site)
 *   node scripts/broken-link-recovery.js --opportunities    (find link targets)
 *   node scripts/broken-link-recovery.js --output report.csv
 *
 * Phase 6.2 — Broken link recovery (TRAFFIC_ROADMAP.md)
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
// Internal broken link scan
// ---------------------------------------------------------------------------

/**
 * Find artists that exist in artist_videos but have no wiki or have been
 * soft-deleted (these would 404 if linked from elsewhere).
 */
async function findDeadArtistReferences(prisma) {
  // Artists with videos but no wiki content — these pages exist but
  // might return empty states. Worth checking if they'd benefit from
  // a 404 → genre redirect.
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        a.id,
        a.artist AS name,
        a.artist_name_norm AS nameNorm,
        a.genre1,
        COUNT(av.video_id) AS videoCount
      FROM artists a
      INNER JOIN artist_videos av ON av.artist_id = a.id
      WHERE (a.wiki_summary IS NULL OR LENGTH(TRIM(a.wiki_summary)) = 0)
      GROUP BY a.id
      HAVING videoCount > 0
      ORDER BY videoCount DESC
      LIMIT 100
    `,
  );

  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name || "").trim(),
    nameNorm: String(row.nameNorm || "").trim(),
    genre1: String(row.genre1 || "").trim(),
    videoCount: toSafeNumber(row.videoCount, 0),
    pageUrl: `${APP_URL}/artist/${encodeURIComponent(String(row.nameNorm || "").trim())}`,
  }));
}

/**
 * Find magazine articles that might be referencing deleted videos.
 */
async function findOrphanedMagazineReferences(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        ma.slug,
        ma.title,
        ma.video_id AS referencedVideoId
      FROM magazine_articles ma
      WHERE ma.video_id IS NOT NULL
        AND ma.status = 'published'
        AND NOT EXISTS (
          SELECT 1 FROM videos v WHERE v.videoId = ma.video_id
        )
      LIMIT 50
    `,
  );

  return rows.map((row) => ({
    slug: String(row.slug || "").trim(),
    title: String(row.title || "").trim(),
    referencedVideoId: String(row.referencedVideoId || "").trim(),
    pageUrl: `${APP_URL}/magazine/${encodeURIComponent(String(row.slug || "").trim())}`,
  }));
}

// ---------------------------------------------------------------------------
// Link opportunity scan
// ---------------------------------------------------------------------------

/**
 * Find high-value artist pages that would make good link targets.
 * These are artists with substantial wiki content and high play counts.
 */
async function findLinkOpportunities(prisma, limit) {
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        a.id,
        a.artist AS name,
        a.artist_name_norm AS nameNorm,
        a.genre1,
        a.genre2,
        a.country,
        LENGTH(a.wiki_summary) AS wikiLength,
        COUNT(av.video_id) AS videoCount,
        SUM(COALESCE(v.favourited, 0)) AS totalFavs
      FROM artists a
      INNER JOIN artist_videos av ON av.artist_id = a.id
      INNER JOIN videos v ON v.id = av.video_id AND v.approved = 1
      WHERE a.wiki_summary IS NOT NULL
        AND LENGTH(TRIM(a.wiki_summary)) > 200
      GROUP BY a.id
      HAVING videoCount >= 3
      ORDER BY wikiLength DESC, totalFavs DESC
      LIMIT ?
    `,
    limit || 100,
  );

  return rows.map((row) => ({
    name: String(row.name || "").trim(),
    nameNorm: String(row.nameNorm || "").trim(),
    genre1: String(row.genre1 || "").trim(),
    genre2: String(row.genre2 || "").trim(),
    country: String(row.country || "").trim(),
    wikiLength: toSafeNumber(row.wikiLength, 0),
    videoCount: toSafeNumber(row.videoCount, 0),
    totalFavs: toSafeNumber(row.totalFavs, 0),
    pageUrl: `${APP_URL}/artist/${encodeURIComponent(String(row.nameNorm || "").trim())}`,
    replacementText: `${String(row.name || "").trim()} — ${String(row.genre1 || "Rock/Metal").trim()} artist page on YehThatRocks`,
  }));
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function escapeCsv(value) {
  if (!value) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const internalMode = args.includes("--internal");
  const opportunitiesMode = args.includes("--opportunities");
  const outputIdx = args.indexOf("--output");
  const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : null;

  if (!internalMode && !opportunitiesMode) {
    console.log("[broken-links] No mode specified. Use --internal or --opportunities.");
    console.log("[broken-links]   --internal      Scan for broken internal links");
    console.log("[broken-links]   --opportunities Find link-building opportunities");
    return;
  }

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

  const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });

  try {
    if (internalMode) {
      console.log("[broken-links] Scanning for internal broken references...\n");

      const [deadArtists, orphanedRefs] = await Promise.all([
        findDeadArtistReferences(prisma),
        findOrphanedMagazineReferences(prisma),
      ]);

      console.log(`Dead artist pages (no wiki): ${deadArtists.length}`);
      for (const a of deadArtists.slice(0, 10)) {
        console.log(`  ${a.name} [${a.genre1}] — ${a.videoCount} videos — ${a.pageUrl}`);
      }
      if (deadArtists.length > 10) {
        console.log(`  ... and ${deadArtists.length - 10} more`);
      }

      console.log(`\nOrphaned magazine references: ${orphanedRefs.length}`);
      for (const m of orphanedRefs.slice(0, 5)) {
        console.log(`  "${m.title}" references deleted video ${m.referencedVideoId} — ${m.pageUrl}`);
      }

      if (outputPath) {
        const rows = [
          ["type", "name", "url", "details"].join(","),
          ...deadArtists.map((a) =>
            ["artist_no_wiki", escapeCsv(a.name), escapeCsv(a.pageUrl), `${a.videoCount} videos, genre: ${a.genre1}`].join(","),
          ),
          ...orphanedRefs.map((m) =>
            ["orphaned_video_ref", escapeCsv(m.title), escapeCsv(m.pageUrl), `References deleted video: ${m.referencedVideoId}`].join(","),
          ),
        ];
        ensureDirFor(outputPath);
        fs.writeFileSync(outputPath, rows.join("\n"));
        console.log(`\n[broken-links] Report written to: ${outputPath}`);
      }
    }

    if (opportunitiesMode) {
      console.log("[broken-links] Finding link-building opportunities...\n");

      const opportunities = await findLinkOpportunities(prisma, 100);

      console.log(`High-value link targets: ${opportunities.length}`);
      for (const o of opportunities.slice(0, 15)) {
        console.log(`  ${o.name} [${o.genre1}] — ${o.videoCount} videos, ${o.totalFavs} favs, ${o.wikiLength} wiki chars`);
        console.log(`    ${o.pageUrl}`);
      }

      if (outputPath) {
        const rows = [
          ["artist", "genre", "country", "video_count", "total_favs", "wiki_chars", "page_url", "suggested_anchor_text"].join(","),
          ...opportunities.map((o) =>
            [
              escapeCsv(o.name),
              escapeCsv(o.genre1),
              escapeCsv(o.country),
              o.videoCount,
              o.totalFavs,
              o.wikiLength,
              escapeCsv(o.pageUrl),
              escapeCsv(o.replacementText),
            ].join(","),
          ),
        ];
        ensureDirFor(outputPath);
        fs.writeFileSync(outputPath, rows.join("\n"));
        console.log(`\n[broken-links] Opportunities written to: ${outputPath}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log("\n[broken-links] Done. Review results manually before acting.");
}

main().catch((error) => {
  console.error("[broken-links] Failed:", error?.message || error);
  process.exit(1);
});
