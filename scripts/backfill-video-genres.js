#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const { parseArg, hasFlag, asNumber } = require("./lib/cli");
const { isRockMetalGenre, normalizeGenreName } = require("./lib/genre-scope");

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

function chunk(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

function normalizeArtistKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeGenre(value) {
  const normalized = normalizeGenreName(value);
  if (!normalized) return null;

  const titled = normalized
    .split(/\s+/)
    .map((token) => {
      if (!token) return token;
      if (/^[A-Z0-9\-+/]+$/.test(token)) return token;
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(" ");

  return titled || null;
}

async function detectVideoGenreSupport(prisma) {
  try {
    const rows = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM videos LIKE 'genre'");
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

async function ensureVideoGenreSupport(prisma) {
  const hasColumn = await detectVideoGenreSupport(prisma);
  if (hasColumn) {
    return true;
  }

  try {
    await prisma.$executeRawUnsafe("ALTER TABLE videos ADD COLUMN genre VARCHAR(255) NULL");
  } catch {
    // Ignore migration races; re-check below.
  }

  return detectVideoGenreSupport(prisma);
}

async function detectArtistColumns(prisma) {
  const columns = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM artists");
  const available = new Set(columns.map((column) => column.Field));

  const name = available.has("artist") ? "artist" : available.has("name") ? "name" : "artist";
  const normalizedName = ["artist_name_norm", "artist_norm", "normalized_artist", "name_normalized"].find((c) => available.has(c)) || null;
  const genreColumns = ["genre1", "genre2", "genre3", "genre4", "genre5", "genre6"].filter((c) => available.has(c));

  return { name, normalizedName, genreColumns };
}

async function detectArtistStatsSupport(prisma) {
  try {
    const rows = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM artist_stats LIKE 'normalized_artist'");
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

async function buildArtistGenreMap(prisma, artistColumns, useArtistStats) {
  const map = new Map();

  if (useArtistStats) {
    try {
      const rows = await prisma.$queryRawUnsafe(`
        SELECT normalized_artist AS artistKey, genre
        FROM artist_stats
        WHERE normalized_artist IS NOT NULL
          AND TRIM(normalized_artist) <> ''
          AND genre IS NOT NULL
          AND TRIM(genre) <> ''
      `);

      for (const row of rows) {
        const key = normalizeArtistKey(row.artistKey);
        const genre = normalizeGenre(row.genre);
        if (!key || !genre) continue;
        if (!isRockMetalGenre(genre)) continue;
        map.set(key, genre);
      }
    } catch {
      // optional table
    }
  }

  if (artistColumns.genreColumns.length > 0) {
    const genreExpr = `COALESCE(${artistColumns.genreColumns.map((col) => `a.\`${col}\``).join(", ")})`;
    const normalizedExpr = artistColumns.normalizedName
      ? `LOWER(TRIM(a.\`${artistColumns.normalizedName}\`))`
      : `LOWER(TRIM(a.\`${artistColumns.name}\`))`;

    const rows = await prisma.$queryRawUnsafe(`
      SELECT ${normalizedExpr} AS artistKey, ${genreExpr} AS genre
      FROM artists a
      WHERE ${normalizedExpr} IS NOT NULL
        AND TRIM(${normalizedExpr}) <> ''
        AND ${genreExpr} IS NOT NULL
        AND TRIM(${genreExpr}) <> ''
    `);

    for (const row of rows) {
      const key = normalizeArtistKey(row.artistKey);
      const genre = normalizeGenre(row.genre);
      if (!key || !genre) continue;
      if (!isRockMetalGenre(genre)) continue;
      if (!map.has(key)) {
        map.set(key, genre);
      }
    }
  }

  return map;
}

async function loadCandidateVideos(prisma, batchSize, offset) {
  return prisma.$queryRawUnsafe(
    `
      SELECT
        v.id,
        v.videoId,
        v.parsedArtist,
        COALESCE(v.parsed_artist_norm, LOWER(TRIM(v.parsedArtist))) AS artistKey,
        v.genre
      FROM videos v
      WHERE v.videoId IS NOT NULL
        AND v.parsedArtist IS NOT NULL
        AND TRIM(v.parsedArtist) <> ''
        AND COALESCE(v.approved, 0) = 1
        AND (
          v.genre IS NULL
          OR TRIM(v.genre) = ''
          OR LOWER(TRIM(v.genre)) = 'rock / metal'
        )
      ORDER BY v.id DESC
      LIMIT ?
      OFFSET ?
    `,
    batchSize,
    offset,
  );
}

async function main() {
  loadDatabaseEnv();

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Add it to apps/web/.env.local.");
    process.exit(1);
  }

  const dryRun = hasFlag("dry-run");
  const limit = asNumber(parseArg("limit", "0"), 0, { min: 0 });
  const batchSize = asNumber(parseArg("batch-size", "2000"), 2000, { min: 100, max: 10000 });
  const updateChunkSize = asNumber(parseArg("update-chunk-size", "250"), 250, { min: 25, max: 1000 });

  const prisma = new PrismaClient();

  try {
    const hasVideoGenre = await ensureVideoGenreSupport(prisma);
    if (!hasVideoGenre) {
      console.error("videos.genre column not found. Nothing to backfill.");
      process.exit(1);
    }

    const artistColumns = await detectArtistColumns(prisma);
    const artistStatsAvailable = await detectArtistStatsSupport(prisma);
    const artistGenreMap = await buildArtistGenreMap(prisma, artistColumns, artistStatsAvailable);

    console.log(`Loaded artist genre evidence for ${artistGenreMap.size.toLocaleString()} artists.`);

    let offset = 0;
    let scanned = 0;
    let matched = 0;
    let updated = 0;

    while (true) {
      const rows = await loadCandidateVideos(prisma, batchSize, offset);
      if (!rows.length) break;

      scanned += rows.length;
      const updatesByGenre = new Map();

      for (const row of rows) {
        const artistKey = normalizeArtistKey(row.artistKey || row.parsedArtist);
        if (!artistKey) continue;

        const inferredGenre = artistGenreMap.get(artistKey) || null;
        if (!inferredGenre) continue;

        matched += 1;
        if (!updatesByGenre.has(inferredGenre)) {
          updatesByGenre.set(inferredGenre, []);
        }
        updatesByGenre.get(inferredGenre).push(Number(row.id));
      }

      if (!dryRun) {
        for (const [genre, ids] of updatesByGenre.entries()) {
          for (const idChunk of chunk(ids, updateChunkSize)) {
            const placeholders = idChunk.map(() => "?").join(", ");
            const count = await prisma.$executeRawUnsafe(
              `UPDATE videos SET genre = ? WHERE id IN (${placeholders})`,
              genre,
              ...idChunk,
            );
            updated += Number(count || 0);
          }
        }
      } else {
        for (const ids of updatesByGenre.values()) {
          updated += ids.length;
        }
      }

      if (limit > 0 && scanned >= limit) {
        break;
      }

      offset += rows.length;
      console.log(`Scanned ${scanned.toLocaleString()} candidate videos...`);
    }

    console.log("");
    console.log(`Scanned candidates: ${scanned.toLocaleString()}`);
    console.log(`Matched by artist evidence: ${matched.toLocaleString()}`);
    console.log(`${dryRun ? "Would update" : "Updated"}: ${updated.toLocaleString()} video rows`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
