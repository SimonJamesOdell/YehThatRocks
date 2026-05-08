#!/usr/bin/env node
// Single-use script: normalise video titles, parsedArtist and parsedTrack.
//   parsedArtist → ALL CAPS
//   parsedTrack  → stripped of YouTube noise tags, then Every Word Capitalised
//   title        → rebuilt as "ARTIST - Track Name"
//
// Usage:
//   node scripts/update-track-titles.js             # dry-run (no DB writes)
//   node scripts/update-track-titles.js --commit    # write changes

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

// ── YouTube noise tag stripping ────────────────────────────────────────────
// Matches common suffixes in both () and [] brackets, case-insensitive.
// Applied repeatedly until stable so nested/multiple tags are removed.

const NOISE_PATTERNS = [
  // Official variants
  /[\[(]\s*official\s+music\s+video\s*[\])]/gi,
  /[\[(]\s*official\s+hd\s+(?:music\s+)?video\s*[\])]/gi,
  /[\[(]\s*official\s+lyric\s+video\s*[\])]/gi,
  /[\[(]\s*official\s+audio\s*[\])]/gi,
  /[\[(]\s*official\s+video\s*[\])]/gi,
  /[\[(]\s*official\s+clip\s*[\])]/gi,
  /[\[(]\s*official\s*[\])]/gi,
  // Music video variants
  /[\[(]\s*music\s+video\s*[\])]/gi,
  /[\[(]\s*music\s+clip\s*[\])]/gi,
  // Lyrics
  /[\[(]\s*lyric\s+video\s*[\])]/gi,
  /[\[(]\s*lyrics\s+video\s*[\])]/gi,
  /[\[(]\s*lyrics\s*[\])]/gi,
  /[\[(]\s*lyric\s*[\])]/gi,
  /[\[(]\s*with\s+lyrics\s*[\])]/gi,
  // Audio/video quality tags
  /[\[(]\s*hd\s*[\])]/gi,
  /[\[(]\s*hq\s*[\])]/gi,
  /[\[(]\s*4k\s*[\])]/gi,
  /[\[(]\s*1080p\s*[\])]/gi,
  /[\[(]\s*720p\s*[\])]/gi,
  // Explicit
  /[\[(]\s*explicit\s*[\])]/gi,
  /[\[(]\s*clean\s+version\s*[\])]/gi,
  // Audio
  /[\[(]\s*audio\s*[\])]/gi,
  /[\[(]\s*audio\s+only\s*[\])]/gi,
  // Video
  /[\[(]\s*video\s*[\])]/gi,
  /[\[(]\s*visualizer\s*[\])]/gi,
  /[\[(]\s*visualiser\s*[\])]/gi,
  // Misc promo tags
  /[\[(]\s*premiere\s*[\])]/gi,
  /[\[(]\s*full\s+song\s*[\])]/gi,
  /[\[(]\s*full\s+video\s*[\])]/gi,
  /[\[(]\s*new\s+(?:single|song|video|album)\s*[\])]/gi,
  /[\[(]\s*single\s*[\])]/gi,
  /[\[(]\s*clip\s+officiel\s*[\])]/gi,
  /[\[(]\s*vídeo\s+oficial\s*[\])]/gi,
  /[\[(]\s*video\s+oficial\s*[\])]/gi,
];

function stripNoiseTags(str) {
  if (!str) return str;
  let prev = "";
  let s = str;
  while (s !== prev) {
    prev = s;
    for (const pattern of NOISE_PATTERNS) {
      s = s.replace(pattern, "");
    }
    s = s.trim();
  }
  // Remove wrapping quotes (single or double, smart or straight)
  s = s.replace(/^[\u201C\u201D"'`\u2018\u2019]+|[\u201C\u201D"'`\u2018\u2019]+$/g, "").trim();
  // Collapse extra whitespace and trailing dashes/pipes left after tag removal
  s = s.replace(/\s*[-|]\s*$/, "").trim();
  return s;
}

function titleCase(str) {
  if (!str) return str;
  return str
    .split(/\s+/)
    .map((word) => capitaliseWord(word))
    .join(" ");
}

function capitaliseWord(word) {
  // Preserve all-caps acronyms (e.g. "AC", "USA") untouched
  if (word.length <= 3 && word === word.toUpperCase() && /^[A-Z]+$/.test(word)) {
    return word;
  }
  // Capitalise first letter, lowercase the rest
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function formatArtist(str) {
  if (!str) return str;
  return str.toUpperCase();
}

function buildTitle(artist, track) {
  if (!artist && !track) return null;
  if (!artist) return track;
  if (!track) return artist;
  return `${artist} - ${track}`;
}

// ── Env loading ────────────────────────────────────────────────────────────

function loadEnv() {
  const candidates = [
    path.resolve(process.cwd(), "apps/web/.env.local"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const m = t.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const [, key, raw] = m;
      if (!process.env[key]) process.env[key] = raw.replace(/^"/, "").replace(/"$/, "");
    }
    break; // first found wins
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  loadEnv();

  const commit = process.argv.includes("--commit");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — add apps/web/.env.local or pass DATABASE_URL");
  }

  const prisma = new PrismaClient();

  try {
    const BATCH = 1000;
    let offset = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;

    console.log(`Mode: ${commit ? "COMMIT (writing to DB)" : "DRY-RUN (no writes)"}\n`);

    for (;;) {
      const rows = await prisma.video.findMany({
        select: { id: true, title: true, parsedArtist: true, parsedTrack: true },
        skip: offset,
        take: BATCH,
        orderBy: { id: "asc" },
      });

      if (rows.length === 0) break;

      const updates = [];
      for (const row of rows) {
        const newArtist = row.parsedArtist ? formatArtist(row.parsedArtist) : row.parsedArtist;
        const cleanedTrack = row.parsedTrack ? stripNoiseTags(row.parsedTrack) : row.parsedTrack;
        const newTrack = cleanedTrack ? titleCase(cleanedTrack) : cleanedTrack;
        const newTitle = buildTitle(newArtist, newTrack) ?? row.title;

        if (
          newArtist === row.parsedArtist &&
          newTrack === row.parsedTrack &&
          newTitle === row.title
        ) {
          totalSkipped++;
          continue;
        }

        updates.push({ id: row.id, parsedArtist: newArtist, parsedTrack: newTrack, title: newTitle });
      }

      if (updates.length > 0) {
        if (commit) {
          for (const u of updates) {
            await prisma.video.update({
              where: { id: u.id },
              data: { parsedArtist: u.parsedArtist, parsedTrack: u.parsedTrack, title: u.title },
            });
          }
        } else {
          // Dry-run: print a sample of changes (first 20 from this batch)
          for (const u of updates.slice(0, 20)) {
            const orig = rows.find((r) => r.id === u.id);
            console.log(`  [${u.id}]`);
            if (orig.title !== u.title)
              console.log(`    title  : "${orig.title}"`);
            console.log(`           → "${u.title}"`);
            if (orig.parsedArtist !== u.parsedArtist)
              console.log(`    artist : "${orig.parsedArtist}" → "${u.parsedArtist}"`);
            if (orig.parsedTrack !== u.parsedTrack)
              console.log(`    track  : "${orig.parsedTrack}" → "${u.parsedTrack}"`);
          }
        }
        totalUpdated += updates.length;
      }

      offset += rows.length;
      process.stdout.write(`\rProcessed ${offset} rows, ${totalUpdated} to update, ${totalSkipped} unchanged...`);
    }

    console.log(`\n\nDone.`);
    console.log(`  Rows examined : ${offset}`);
    console.log(`  To update     : ${totalUpdated}`);
    console.log(`  Unchanged     : ${totalSkipped}`);
    if (!commit && totalUpdated > 0) {
      console.log(`\nRe-run with --commit to write these changes.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

