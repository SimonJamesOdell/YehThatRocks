#!/usr/bin/env node
/**
 * Builds static sitemap XML files from the live database.
 * Runs standalone (no Next.js dependency) — uses Prisma + raw SQL directly.
 *
 * Output directory: /srv/yehthatrocks/sitemaps/
 * Served by NGINX via: location /sitemap { alias /srv/yehthatrocks/sitemaps/; }
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITEMAPS_DIR = process.env.SITEMAPS_OUT || "/srv/yehthatrocks/sitemaps";
const VIDEO_SITEMAP_PAGE_SIZE = 50_000;

const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://yehthatrocks.com").replace(/\/$/, "");

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildUrl(slug) {
  if (/^https?:\/\//i.test(slug)) return slug;
  return `${SITE_ORIGIN}/${slug.replace(/^\//, "")}`;
}

function toIso(value) {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

function buildSitemapIndex(shardIds) {
  const now = new Date().toISOString();
  const entries = shardIds.map((id) =>
    `  <sitemap>\n    <loc>${xmlEscape(buildUrl(`/sitemap/${id}.xml`))}</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`;
}

function buildSitemapUrlSet(entries) {
  const urls = entries.map((e) => {
    const parts = [`  <url>`, `    <loc>${xmlEscape(e.loc)}</loc>`];
    if (e.lastmod) parts.push(`    <lastmod>${xmlEscape(e.lastmod)}</lastmod>`);
    if (e.changefreq) parts.push(`    <changefreq>${e.changefreq}</changefreq>`);
    if (e.priority != null) parts.push(`    <priority>${e.priority.toFixed(1)}</priority>`);
    parts.push(`  </url>`);
    return parts.join("\n");
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL not set");

  const prisma = new PrismaClient({
    adapter: new PrismaMariaDb(databaseUrl),
    errorFormat: "pretty",
  });

  try {
    // --- Shard 0: static pages + categories + magazine + top artists ---
    console.log("Building static sitemap shard...");

    const entries = [
      { loc: buildUrl("/"), priority: 1.0, changefreq: "daily" },
      { loc: buildUrl("/categories"), priority: 0.9, changefreq: "weekly" },
      { loc: buildUrl("/top100"), priority: 0.9, changefreq: "weekly" },
      { loc: buildUrl("/artists"), priority: 0.8, changefreq: "weekly" },
      { loc: buildUrl("/new"), priority: 0.8, changefreq: "daily" },
      { loc: buildUrl("/magazine"), priority: 0.8, changefreq: "daily" },
    ];

    // Categories
    const genreRows = await prisma.$queryRawUnsafe(`SELECT DISTINCT gc.genre FROM genre_cards gc ORDER BY gc.genre`);
    for (const row of genreRows) {
      const slug = String(row.genre).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      entries.push({ loc: buildUrl(`/categories/${slug}`), priority: 0.7, changefreq: "weekly" });
    }

    // Magazine
    const magRows = await prisma.$queryRawUnsafe(`SELECT slug FROM magazine_articles WHERE status = 'published' ORDER BY published_at DESC LIMIT 2000`);
    for (const row of magRows) {
      entries.push({ loc: buildUrl(`/magazine/${row.slug}`), priority: 0.8, changefreq: "monthly" });
    }

    // Top 2000 artists (alphabetical)
    const artistRows = await prisma.$queryRawUnsafe(
      `SELECT artist FROM artists ORDER BY artist ASC LIMIT 2000`
    );
    for (const row of artistRows) {
      const name = String(row.artist).trim();
      if (!name) continue;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      entries.push({ loc: buildUrl(`/artist/${slug}`), priority: 0.6, changefreq: "monthly" });
    }

    await fs.mkdir(SITEMAPS_DIR, { recursive: true });
    await fs.writeFile(path.join(SITEMAPS_DIR, "0.xml"), buildSitemapUrlSet(entries), "utf8");
    console.log(`  ✓ 0.xml (${entries.length} URLs)`);

    // --- Video shards ---
    const countRows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS total FROM videos v
       INNER JOIN site_videos sv ON sv.video_id = v.videoId AND sv.status = 'available'
       WHERE v.approved = 1 AND v.videoId IS NOT NULL AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'`
    );
    const totalVideos = Number(countRows[0]?.total ?? 0);
    const shardCount = Math.max(1, Math.ceil(totalVideos / VIDEO_SITEMAP_PAGE_SIZE));
    console.log(`  ${totalVideos} approved videos → ${shardCount} video shard(s)`);

    const shardIds = [0, ...Array.from({ length: shardCount }, (_, i) => i + 1)];

    for (let shard = 1; shard <= shardCount; shard++) {
      const offset = (shard - 1) * VIDEO_SITEMAP_PAGE_SIZE;
      const videoRows = await prisma.$queryRawUnsafe(
        `SELECT v.videoId, COALESCE(v.updated_at, v.approved_at, v.created_at) AS lastModified
         FROM videos v
         INNER JOIN site_videos sv ON sv.video_id = v.videoId AND sv.status = 'available'
         WHERE v.approved = 1 AND v.videoId IS NOT NULL AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
         ORDER BY v.id ASC
         LIMIT ? OFFSET ?`,
        VIDEO_SITEMAP_PAGE_SIZE,
        offset
      );
      const videoEntries = videoRows.map((r) => ({
        loc: buildUrl(`/?v=${encodeURIComponent(r.videoId)}`),
        lastmod: toIso(r.lastModified),
        priority: 0.7,
        changefreq: "monthly",
      }));
      await fs.writeFile(path.join(SITEMAPS_DIR, `${shard}.xml`), buildSitemapUrlSet(videoEntries), "utf8");
      console.log(`  ✓ ${shard}.xml (${videoEntries.length} URLs)`);
    }

    // --- Sitemap index ---
    await fs.writeFile(path.join(SITEMAPS_DIR, "sitemap.xml"), buildSitemapIndex(shardIds), "utf8");
    console.log(`  ✓ sitemap.xml (index, ${shardIds.length} shards)`);

    console.log(`✓ Sitemaps written to ${SITEMAPS_DIR}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("✗ Failed to build sitemaps:", err);
  process.exit(1);
});
