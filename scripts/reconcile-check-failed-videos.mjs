#!/usr/bin/env node

/**
 * One-off reconciliation for the `check-failed` backlog in site_videos.
 *
 * For each video that currently has only a `check-failed` site_videos row (no
 * `available` row), this script verifies it against the authenticated YouTube
 * Data API (videos.list, part=status,contentDetails) and then either:
 *
 *   - flips it back to `available`   (uploadStatus=processed + embeddable),
 *   - marks it `unavailable`          (embeddable=false or age-restricted), or
 *   - prunes it                       (uploadStatus deleted/failed/rejected, or
 *                                      absent from the API = deleted/private).
 *
 * The Data API is bot-check resistant, unlike the embed/watch-page scrape the
 * runtime verifier falls back to. It supports up to 50 ids per request, so the
 * ~15k backlog needs only ~300 calls instead of 15k.
 *
 * Usage:
 *   node scripts/reconcile-check-failed-videos.mjs                 # dry-run
 *   node scripts/reconcile-check-failed-videos.mjs --limit=100     # dry-run sample
 *   node scripts/reconcile-check-failed-videos.mjs --apply         # apply changes
 *
 * Environment: DATABASE_URL and YOUTUBE_DATA_API_KEY (the same values the web
 * container already has). Intended to run against the LIVE database from inside
 * the web container (`docker compose exec -T web node scripts/...`).
 */

import { createRequire } from "node:module";

// Resolve mysql2 from a known node_modules anchor: the deployed web container
// (/app) or the local repo (scripts/..). This lets the script run from a
// writable location even though /app itself is read-only in production.
function loadMysql() {
  const anchors = [
    "/app/reconcile-check-failed-videos.mjs",
    import.meta.url,
  ];
  for (const anchor of anchors) {
    try {
      return createRequire(anchor)("mysql2/promise");
    } catch {
      // try the next anchor
    }
  }
  throw new Error("mysql2 not found; install it or run from the repo/container");
}

const mysql = loadMysql();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply") || process.env.RECONCILE_APPLY === "1";
const LIMIT = (() => {
  const envLimit = Number.parseInt(process.env.RECONCILE_LIMIT ?? "", 10);
  if (Number.isFinite(envLimit) && envLimit > 0) return envLimit;
  const flag = args.find((a) => a.startsWith("--limit="));
  if (!flag) return null;
  const value = Number.parseInt(flag.slice("--limit=".length), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
})();
const BATCH_SIZE = (() => {
  const flag = args.find((a) => a.startsWith("--batch-size="));
  if (!flag) return 50;
  const value = Number.parseInt(flag.slice("--batch-size=".length), 10);
  return Number.isFinite(value) && value > 0 && value <= 50 ? value : 50;
})();
const DELAY_MS = 250;

const API_KEY = (process.env.YOUTUBE_DATA_API_KEY ?? "").trim();
const DATABASE_URL = process.env.DATABASE_URL;

function parseDbUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number.parseInt(u.port, 10) || 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    connectionLimit: 4,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callVideosList(ids) {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "status,contentDetails");
  url.searchParams.set("id", ids.join(","));
  url.searchParams.set("key", API_KEY);

  const response = await fetch(url, { headers: { "User-Agent": "YehThatRocks/1.0" } });
  if (!response.ok) {
    return { error: `http-${response.status}` };
  }

  const data = await response.json();
  const itemById = new Map((data.items ?? []).map((item) => [item.id, item]));
  return { itemById };
}

/**
 * Mirrors `pruneVideoAndAssociationsByVideoId` (catalog-data-video-ingestion.ts).
 * Removes the video from every association table before deleting the videos row.
 */
async function pruneVideo(pool, { id, videoId }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Integer-FK tables (reference videos.id).
    await conn.query("DELETE FROM site_videos WHERE video_id = ?", [id]);
    await conn.query("DELETE FROM playlistitems WHERE video_id = ?", [id]);
    await conn.query("DELETE FROM videosbyartist WHERE video_id = ?", [id]);

    // String-keyed row-per-video tables (reference videos.videoId).
    await conn.query("DELETE FROM favourites WHERE videoId = ?", [videoId]);
    await conn.query("DELETE FROM watch_history WHERE video_id = ?", [videoId]);
    await conn.query("DELETE FROM hidden_videos WHERE video_id = ?", [videoId]);
    await conn.query("DELETE FROM messages WHERE video_id = ?", [videoId]);
    await conn.query("DELETE FROM related WHERE videoId = ? OR related = ?", [videoId, videoId]);
    await conn.query("DELETE FROM analytics_events WHERE video_id = ?", [videoId]);

    // Reference-column tables keep their parent row; only the pointer is cleared.
    await conn.query(
      "UPDATE genre_cards SET thumbnail_video_id = NULL WHERE CONVERT(thumbnail_video_id USING utf8mb4) = CONVERT(? USING utf8mb4)",
      [videoId],
    );
    await conn.query("UPDATE artist_stats SET thumbnail_video_id = NULL WHERE thumbnail_video_id = ?", [videoId]);
    await conn.query("UPDATE magazine_articles SET video_id = NULL WHERE video_id = ?", [videoId]);
    await conn.query("UPDATE forum_threads SET video1_id = NULL WHERE video1_id = ?", [videoId]);
    await conn.query("UPDATE forum_threads SET video2_id = NULL WHERE video2_id = ?", [videoId]);

    await conn.query("DELETE FROM videos WHERE id = ?", [id]);
    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    console.error(`prune failed for ${videoId}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    conn.release();
  }
}

async function main() {
  if (!API_KEY) {
    console.error("YOUTUBE_DATA_API_KEY is not set.");
    process.exit(1);
  }
  if (!DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = mysql.createPool(parseDbUrl(DATABASE_URL));

  const limitClause = LIMIT ? `LIMIT ${LIMIT}` : "";
  const [rows] = await pool.query(
    `
      SELECT v.id, v.videoId
      FROM videos v
      JOIN site_videos sv ON sv.video_id = v.id AND sv.status = 'check-failed'
      LEFT JOIN site_videos sv_avail ON sv_avail.video_id = v.id AND sv_avail.status = 'available'
      WHERE sv_avail.video_id IS NULL
      GROUP BY v.id, v.videoId
      ORDER BY v.id ASC
      ${limitClause}
    `,
  );

  console.log(`mode=${APPLY ? "apply" : "dry-run"} target=${rows.length} batchSize=${BATCH_SIZE}`);

  const flips = [];
  const unavailable = [];
  const prunes = [];
  let skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const ids = batch.map((row) => row.videoId);
    const result = await callVideosList(ids);

    if (result.error) {
      skipped += batch.length;
      console.log(`  batch ${i + 1}-${i + batch.length}: skipped (${result.error})`);
      await sleep(DELAY_MS);
      continue;
    }

    for (const row of batch) {
      const item = result.itemById.get(row.videoId);
      if (!item) {
        prunes.push(row);
        continue;
      }

      const uploadStatus = item.status?.uploadStatus;
      if (uploadStatus && uploadStatus !== "processed") {
        prunes.push(row);
        continue;
      }

      if (item.status?.embeddable === false) {
        unavailable.push(row);
        continue;
      }

      if (item.contentDetails?.contentRating?.ytRating === "ytAgeRestricted") {
        unavailable.push(row);
        continue;
      }

      flips.push(row);
    }

    await sleep(DELAY_MS);
  }

  console.log("\nDry-run summary:");
  console.log(`  flip to available:   ${flips.length}`);
  console.log(`  mark unavailable:    ${unavailable.length}`);
  console.log(`  prune (dead):        ${prunes.length}`);
  console.log(`  skipped (api error): ${skipped}`);
  console.log(`  total:               ${rows.length}`);

  if (flips.length > 0) {
    console.log("\nSample flips:");
    for (const row of flips.slice(0, 10)) {
      console.log(`  ${row.videoId}`);
    }
  }
  if (prunes.length > 0) {
    console.log("\nSample prunes:");
    for (const row of prunes.slice(0, 10)) {
      console.log(`  ${row.videoId}`);
    }
  }

  if (!APPLY) {
    await pool.end();
    console.log("\n(dry-run complete; re-run with --apply to apply)");
    return;
  }

  console.log("\nApplying changes...");

  let flipped = 0;
  for (const row of flips) {
    const [result] = await pool.query(
      `
        UPDATE site_videos sv
        JOIN videos v ON v.id = sv.video_id
        SET sv.status = 'available',
            sv.title = LEFT(COALESCE(v.title, sv.title), 255)
        WHERE sv.video_id = ? AND sv.status = 'check-failed'
      `,
      [row.id],
    );
    flipped += result.affectedRows;
  }
  console.log(`  flipped site_videos rows: ${flipped}`);

  let markedUnavailable = 0;
  for (const row of unavailable) {
    const [result] = await pool.query(
      "UPDATE site_videos SET status = 'unavailable' WHERE video_id = ? AND status = 'check-failed'",
      [row.id],
    );
    markedUnavailable += result.affectedRows;
  }
  console.log(`  marked unavailable: ${markedUnavailable}`);

  let pruned = 0;
  for (const row of prunes) {
    const ok = await pruneVideo(pool, row);
    if (ok) pruned += 1;
  }
  console.log(`  pruned videos: ${pruned}`);

  await pool.end();
  console.log("\nReconciliation complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
