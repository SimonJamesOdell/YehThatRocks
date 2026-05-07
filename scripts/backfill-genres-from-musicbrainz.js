#!/usr/bin/env node
/**
 * backfill-genres-from-musicbrainz.js
 *
 * Looks up each artist in MusicBrainz and overwrites the genre1-6 columns in
 * the `artists` table with authoritative, tag-voted genre data.
 *
 * Only artists that have at least --min-video-count videos in artist_stats are
 * processed. Only high-confidence MB matches (score >= --min-score and exact
 * name match) are written back.
 *
 * Progress is checkpointed to --checkpoint (default
 * scripts/.genre-backfill-checkpoint.json) so the script is safely resumable.
 *
 * Usage:
 *   node scripts/backfill-genres-from-musicbrainz.js
 *   node scripts/backfill-genres-from-musicbrainz.js --dry-run
 *   node scripts/backfill-genres-from-musicbrainz.js --limit=500
 *   node scripts/backfill-genres-from-musicbrainz.js --min-video-count=2
 *   node scripts/backfill-genres-from-musicbrainz.js --min-score=95
 *
 * MusicBrainz rate limit: 1 request/second. Use --delay-ms to tune (default 1100).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const { isRockMetalGenre } = require("./lib/genre-scope");

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function loadDatabaseEnv() {
  const envPath = path.resolve(process.cwd(), "apps/web/.env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^"/, "").replace(/"$/, "");
  }
}

function parseArg(name, fallback) {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw ? raw.slice(name.length + 3) : fallback;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

// ---------------------------------------------------------------------------
// CLI options
// ---------------------------------------------------------------------------

const DRY_RUN = flag("dry-run");
const LIMIT = Math.max(1, Number(parseArg("limit", "0")) || Infinity);
const MIN_VIDEO_COUNT = Math.max(1, Number(parseArg("min-video-count", "1")));
const MIN_SCORE = Math.max(1, Number(parseArg("min-score", "100")));
const DELAY_MS = Math.max(500, Number(parseArg("delay-ms", "1100")));
const CHECKPOINT_PATH = path.resolve(
  process.cwd(),
  parseArg("checkpoint", "scripts/.genre-backfill-checkpoint.json"),
);
const MAX_GENRES = 6;

// MusicBrainz requires a meaningful User-Agent including a contact URL or email
const USER_AGENT = "YehThatRocks/1.0 (https://yehthatrocks.com)";
const MB_BASE = "https://musicbrainz.org/ws/2";

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_PATH)) return { done: {} };
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8"));
  } catch {
    return { done: {} };
  }
}

function saveCheckpoint(cp) {
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(cp, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// MusicBrainz
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Search MusicBrainz for an artist by exact name.
 * Returns the best match or null.
 */
async function searchMbArtist(artistName) {
  // Use quoted phrase + type:group to prefer bands over solo artists with
  // the same name. We fetch 5 results and pick the best exact-name match.
  const encoded = encodeURIComponent(`artist:"${artistName}"`);
  const url = `${MB_BASE}/artist?query=${encoded}&limit=5&fmt=json`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });

  if (res.status === 503 || res.status === 429) {
    // Rate limited — wait 10 s and retry once
    await sleep(10000);
    return searchMbArtist(artistName);
  }

  if (!res.ok) {
    console.warn(`  MB HTTP ${res.status} for "${artistName}"`);
    return null;
  }

  const data = await res.json();
  const artists = data.artists ?? [];

  if (artists.length === 0) return null;

  // Prefer exact name match with highest score; fall back to best score.
  const nameLower = artistName.toLowerCase();
  const exact = artists.filter(
    (a) => (a.name ?? "").toLowerCase() === nameLower && Number(a.score) >= MIN_SCORE,
  );
  if (exact.length > 0) {
    // Among exact matches, prefer the one with the most tags (more community data)
    exact.sort((a, b) => (b.tags ?? []).length - (a.tags ?? []).length);
    return exact[0];
  }

  // No exact match — skip
  return null;
}

/**
 * Extract genre tags from a MusicBrainz artist result.
 * Returns an array of title-cased genre strings, sorted by vote count desc,
 * filtered to rock/metal genres, max MAX_GENRES entries.
 */
function extractGenres(mbArtist) {
  const rawTags = mbArtist.tags ?? [];

  // Filter to rock/metal relevant tags and sort by count descending
  const metalTags = rawTags
    .filter((t) => isRockMetalGenre(t.name))
    .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));

  // Title-case each genre name
  const titleCase = (str) =>
    str
      .split(" ")
      .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ");

  return metalTags.slice(0, MAX_GENRES).map((t) => titleCase(t.name));
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function normalizeArtistName(name) {
  return (name ?? "").trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

loadDatabaseEnv();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to apps/web/.env.local.");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  console.log(
    `Starting genre backfill from MusicBrainz${DRY_RUN ? " (DRY RUN — no writes)" : ""}`,
  );
  console.log(
    `  Min video count: ${MIN_VIDEO_COUNT} | Min MB score: ${MIN_SCORE} | Delay: ${DELAY_MS}ms | Limit: ${LIMIT === Infinity ? "all" : LIMIT}`,
  );
  console.log(`  Checkpoint: ${CHECKPOINT_PATH}\n`);

  const cp = loadCheckpoint();

  // Fetch all distinct artist names that have videos
  // Join artists to artist_stats on normalised name so we respect the video
  // count threshold but operate on the artists table's primary key.
  const rows = await prisma.$queryRawUnsafe(`
    SELECT a.id, a.artist AS artistName
    FROM artists a
    INNER JOIN artist_stats ast ON LOWER(TRIM(ast.display_name)) = LOWER(TRIM(a.artist))
    WHERE ast.video_count >= ?
    ORDER BY ast.video_count DESC, a.artist ASC
  `, MIN_VIDEO_COUNT);

  console.log(`Found ${rows.length} artists with >= ${MIN_VIDEO_COUNT} video(s).\n`);

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let noMatch = 0;
  let errors = 0;

  for (const row of rows) {
    const artistName = String(row.artistName ?? "").trim();
    const artistId = Number(row.id);

    if (!artistName) continue;

    const cpKey = normalizeArtistName(artistName);
    if (cp.done[cpKey]) {
      skipped++;
      continue;
    }

    if (processed >= LIMIT) break;
    processed++;

    // Throttle
    await sleep(DELAY_MS);

    let mbArtist;
    try {
      mbArtist = await searchMbArtist(artistName);
    } catch (err) {
      console.error(`  ERROR fetching "${artistName}": ${err.message}`);
      errors++;
      continue;
    }

    if (!mbArtist) {
      noMatch++;
      cp.done[cpKey] = { result: "no_match" };
      if (processed % 50 === 0) saveCheckpoint(cp);
      if (DRY_RUN || processed % 20 === 0) {
        console.log(`[${processed}] "${artistName}" — no MB match`);
      }
      continue;
    }

    const genres = extractGenres(mbArtist);

    if (genres.length === 0) {
      noMatch++;
      cp.done[cpKey] = { result: "no_metal_tags", mbName: mbArtist.name };
      if (processed % 50 === 0) saveCheckpoint(cp);
      if (DRY_RUN || processed % 20 === 0) {
        console.log(
          `[${processed}] "${artistName}" → MB:"${mbArtist.name}" — matched but no metal/rock tags`,
        );
      }
      continue;
    }

    updated++;
    cp.done[cpKey] = { result: "updated", mbName: mbArtist.name, genres };
    if (processed % 50 === 0) saveCheckpoint(cp);

    const [g1, g2, g3, g4, g5, g6] = genres;
    console.log(
      `[${processed}] "${artistName}" → [${genres.join(", ")}]${DRY_RUN ? " (dry-run, not written)" : ""}`,
    );

    if (!DRY_RUN) {
      // genre_all is a plain (non-generated) column — update it to match the
      // new genre values so FULLTEXT searches stay accurate.
      const genreAll = genres.join(" ") || null;
      await prisma.$executeRawUnsafe(
        `UPDATE artists
         SET genre1 = ?, genre2 = ?, genre3 = ?, genre4 = ?, genre5 = ?, genre6 = ?, genre_all = ?
         WHERE id = ?`,
        g1 ?? null,
        g2 ?? null,
        g3 ?? null,
        g4 ?? null,
        g5 ?? null,
        g6 ?? null,
        genreAll,
        artistId,
      );
    }
  }

  saveCheckpoint(cp);

  console.log(`\n--- Summary ---`);
  console.log(`  Processed this run : ${processed}`);
  console.log(`  Updated            : ${updated}`);
  console.log(`  No MB match        : ${noMatch}`);
  console.log(`  Skipped (done)     : ${skipped}`);
  console.log(`  Errors             : ${errors}`);
  if (DRY_RUN) {
    console.log(`\n(Dry-run: no database writes were made.)`);
  }
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
