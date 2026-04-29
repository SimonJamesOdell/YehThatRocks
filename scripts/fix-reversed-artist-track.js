#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

const APPLY_CONFIRM_TOKEN = "SWAP_ARTIST_TRACK";

function loadDatabaseEnv() {
  const candidateEnvPaths = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "apps/web/.env.local"),
    path.resolve(process.cwd(), ".env.production"),
    path.resolve(process.cwd(), "apps/web/.env.production"),
  ];

  for (const envPath of candidateEnvPaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) {
        continue;
      }

      const [, key, rawValue] = match;
      if (process.env[key]) {
        continue;
      }

      process.env[key] = rawValue.replace(/^"/, "").replace(/"$/, "");
    }
  }
}

function getArgValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalize(value) {
  return String(value || "")
    .replace(/[\u2012\u2013\u2014\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function splitTitle(title) {
  const raw = String(title || "").trim();
  if (!raw) {
    return null;
  }

  const separators = [" - ", " – ", " — ", " | "];
  let best = null;

  for (const separator of separators) {
    const idx = raw.indexOf(separator);
    if (idx <= 0) {
      continue;
    }

    if (!best || idx < best.idx) {
      best = { idx, separator };
    }
  }

  if (!best) {
    return null;
  }

  const left = raw.slice(0, best.idx).trim();
  const right = raw.slice(best.idx + best.separator.length).trim();

  if (!left || !right) {
    return null;
  }

  return { left, right, separator: best.separator };
}

async function detectArtistNormColumn(prisma) {
  const columns = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM artists");
  const names = new Set(columns.map((column) => String(column.Field || "")));

  if (names.has("artist_name_norm")) {
    return "artist_name_norm";
  }

  return null;
}

async function loadKnownArtistSet(prisma) {
  const normColumn = await detectArtistNormColumn(prisma);
  const expr = normColumn
    ? `LOWER(TRIM(${normColumn}))`
    : "LOWER(TRIM(artist))";

  const rows = await prisma.$queryRawUnsafe(`
    SELECT ${expr} AS norm
    FROM artists
    WHERE artist IS NOT NULL
      AND TRIM(artist) <> ''
  `);

  const artistSet = new Set();
  for (const row of rows) {
    const norm = normalize(row.norm || "");
    if (norm) {
      artistSet.add(norm);
    }
  }

  return artistSet;
}

function isCertainReversal(row, artistSet) {
  const parsedArtistNorm = normalize(row.parsedArtist);
  const parsedTrackNorm = normalize(row.parsedTrack);

  if (!parsedArtistNorm || !parsedTrackNorm || parsedArtistNorm === parsedTrackNorm) {
    return false;
  }

  if (artistSet.has(parsedArtistNorm)) {
    return false;
  }

  if (!artistSet.has(parsedTrackNorm)) {
    return false;
  }

  const split = splitTitle(row.title);
  if (!split) {
    return false;
  }

  const titleLeftNorm = normalize(split.left);
  const titleRightNorm = normalize(split.right);

  // Certain-only rule: title must exactly mirror the swapped metadata.
  if (titleLeftNorm !== parsedTrackNorm) {
    return false;
  }

  if (titleRightNorm !== parsedArtistNorm) {
    return false;
  }

  return true;
}

function usage() {
  console.log(`Usage:
  node scripts/fix-reversed-artist-track.js [--limit=50000] [--batch-size=2000] [--sample=20]
  node scripts/fix-reversed-artist-track.js --apply --confirm=${APPLY_CONFIRM_TOKEN} [--limit=50000] [--batch-size=2000]

Behavior:
  - Dry-run by default (no DB writes).
  - Only swaps parsedArtist/parsedTrack when certainty checks all pass.
  - Certainty checks require BOTH:
    1) parsedTrack is a known artist and parsedArtist is not.
    2) title split matches exactly: <parsedTrack> <separator> <parsedArtist>.
`);
}

async function main() {
  if (hasFlag("help") || hasFlag("h")) {
    usage();
    return;
  }

  const apply = hasFlag("apply");
  const confirm = getArgValue("confirm", "");
  const limit = parsePositiveInt(getArgValue("limit", "50000"), 50000);
  const batchSize = parsePositiveInt(getArgValue("batch-size", "2000"), 2000);
  const sampleSize = parsePositiveInt(getArgValue("sample", "20"), 20);

  if (apply && confirm !== APPLY_CONFIRM_TOKEN) {
    throw new Error(
      `Refusing to write to DB without --confirm=${APPLY_CONFIRM_TOKEN}`,
    );
  }

  loadDatabaseEnv();
  const prisma = new PrismaClient();

  try {
    const artistSet = await loadKnownArtistSet(prisma);

    let lastId = 0;
    let scanned = 0;
    let candidateCount = 0;
    const candidates = [];

    while (scanned < limit) {
      const remaining = limit - scanned;
      const take = Math.min(batchSize, remaining);

      const rows = await prisma.$queryRawUnsafe(
        `
          SELECT id, videoId, title, parsedArtist, parsedTrack
          FROM videos
          WHERE id > ?
            AND parsedArtist IS NOT NULL
            AND parsedTrack IS NOT NULL
            AND TRIM(parsedArtist) <> ''
            AND TRIM(parsedTrack) <> ''
          ORDER BY id ASC
          LIMIT ?
        `,
        lastId,
        take,
      );

      if (!rows.length) {
        break;
      }

      for (const row of rows) {
        scanned += 1;
        lastId = row.id;

        if (isCertainReversal(row, artistSet)) {
          candidateCount += 1;
          candidates.push({
            id: row.id,
            videoId: row.videoId,
            title: row.title,
            fromArtist: row.parsedArtist,
            fromTrack: row.parsedTrack,
            toArtist: row.parsedTrack,
            toTrack: row.parsedArtist,
          });
        }
      }
    }

    console.log(`Scanned rows: ${scanned}`);
    console.log(`Certain reversal candidates: ${candidateCount}`);
    console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);

    const sample = candidates.slice(0, sampleSize);
    if (sample.length > 0) {
      console.log("\nSample candidates:");
      for (const item of sample) {
        console.log(
          `- id=${item.id} videoId=${item.videoId} | title=\"${item.title}\" | artist: \"${item.fromArtist}\" -> \"${item.toArtist}\" | track: \"${item.fromTrack}\" -> \"${item.toTrack}\"`,
        );
      }
    }

    if (!apply) {
      console.log("\nDry-run only. Re-run with --apply and --confirm token to write changes.");
      return;
    }

    if (candidates.length === 0) {
      console.log("\nNo certain reversal candidates found. No changes made.");
      return;
    }

    const now = new Date();
    let updated = 0;

    await prisma.$transaction(async (tx) => {
      for (const item of candidates) {
        await tx.$executeRaw`
          UPDATE videos
          SET
            parsedArtist = ${item.toArtist},
            parsedTrack = ${item.toTrack},
            parsedAt = ${now}
          WHERE id = ${item.id}
        `;
        updated += 1;
      }
    });

    console.log(`\nUpdated rows: ${updated}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
