#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const mysql = require("mysql2/promise");
const { parseArg, asNumber } = require("./lib/cli");
const { loadDatabaseEnv } = require("./lib/runtime");

const TOP_LEVEL_GENRE_BUCKETS = [
  { label: "Rock & Alternative", terms: ["rock", "grunge", "shoegaze", "post rock"] },
  { label: "Punk & Hardcore", terms: ["punk", "post hardcore", "hardcore", "screamo"] },
  { label: "Classic Metal", terms: ["heavy", "nwobhm", "glam", "power", "symphonic", "thrash"] },
  { label: "Black Metal", terms: ["deathcore", "death", "black", "grind"] },
  { label: "Doom & Sludge", terms: ["post doom", "doom", "sludge", "stoner"] },
  { label: "Modern Metal", terms: ["metalcore", "djent", "groove", "nu metal", "mathcore"] },
  { label: "Progressive & Experimental", terms: ["post black", "post metal", "progressive", "industrial"] },
];

function normalizeGenreToken(input) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenMatchesTerm(normalizedToken, normalizedTerm) {
  return normalizedToken === normalizedTerm
    || normalizedToken.startsWith(`${normalizedTerm} `)
    || normalizedToken.endsWith(` ${normalizedTerm}`)
    || normalizedToken.includes(` ${normalizedTerm} `);
}

function resolveTopLevelGenreBucket(input) {
  const normalizedInput = normalizeGenreToken(input);
  if (!normalizedInput) {
    return null;
  }

  const hasRockToken = tokenMatchesTerm(normalizedInput, "rock");
  const hasMetalToken = tokenMatchesTerm(normalizedInput, "metal");
  if (hasRockToken && hasMetalToken) {
    const hasSpecificSubgenreSignal = TOP_LEVEL_GENRE_BUCKETS.some((bucket) =>
      bucket.terms.some((term) => {
        const normalizedTerm = normalizeGenreToken(term);
        if (normalizedTerm === "rock") {
          return false;
        }
        return tokenMatchesTerm(normalizedInput, normalizedTerm);
      }),
    );

    if (!hasSpecificSubgenreSignal) {
      return null;
    }
  }

  for (const bucket of TOP_LEVEL_GENRE_BUCKETS) {
    const normalizedLabel = normalizeGenreToken(bucket.label);
    if (normalizedInput === normalizedLabel) {
      return bucket.label;
    }
  }

  for (const bucket of TOP_LEVEL_GENRE_BUCKETS) {
    for (const term of bucket.terms) {
      const normalizedTerm = normalizeGenreToken(term);
      if (tokenMatchesTerm(normalizedInput, normalizedTerm)) {
        return bucket.label;
      }
    }
  }

  return null;
}

function asInt(value) {
  if (typeof value === "bigint") {
    return Number(value);
  }
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? next : 0;
}

function sortByCountDesc(rows) {
  return [...rows].sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
}

function buildBucketSummary(rawGenreRows) {
  const byBucket = new Map();
  let unknownGenreCount = 0;
  let unbucketedKnownGenreCount = 0;

  for (const row of rawGenreRows) {
    const rawGenre = (row.genre ?? "").trim();
    const count = asInt(row.total);
    if (!rawGenre) {
      unknownGenreCount += count;
      continue;
    }

    const bucket = resolveTopLevelGenreBucket(rawGenre);
    if (!bucket) {
      unbucketedKnownGenreCount += count;
      continue;
    }

    byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + count);
  }

  const bucketRows = sortByCountDesc(
    Array.from(byBucket.entries()).map(([name, count]) => ({ name, count })),
  );

  return {
    bucketRows,
    unknownGenreCount,
    unbucketedKnownGenreCount,
  };
}

function topRows(rows, limit) {
  return rows.slice(0, Math.max(0, limit));
}

loadDatabaseEnv();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to apps/web/.env.local or shell env.");
  process.exit(1);
}
const databaseUrl = String(process.env.DATABASE_URL);
const db = mysql.createPool({
  uri: databaseUrl,
  connectionLimit: 4,
  supportBigNumbers: true,
  bigNumberStrings: false,
});
const sampleLimit = asNumber(parseArg("sample", "20"), 20, { min: 1, max: 200 });
const newestWindow = asNumber(parseArg("newest-window", "1000"), 1000, { min: 50, max: 20000 });
const pendingWindow = asNumber(parseArg("pending-window", "1000"), 1000, { min: 50, max: 20000 });
const artistNeedle = parseArg("artist", "the offspring").trim();
const outPathArg = parseArg("out", "").trim();
const outPath = outPathArg
  ? path.resolve(process.cwd(), outPathArg)
  : path.resolve(process.cwd(), `logs/genre-quality-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

async function query(sql, params = []) {
  const [rows] = await db.query(sql, params);
  return Array.isArray(rows) ? rows : [];
}

async function queryRawGenreCounts(whereClause, params = []) {
  return query(
    `
      SELECT
        TRIM(COALESCE(v.genre, '')) AS genre,
        COUNT(*) AS total
      FROM videos v
      WHERE ${whereClause}
      GROUP BY TRIM(COALESCE(v.genre, ''))
      ORDER BY total DESC, genre ASC
    `,
    params,
  );
}

async function hasColumn(tableName, columnName) {
  const rows = await query(`SHOW COLUMNS FROM \`${tableName}\` LIKE ?`, [columnName]);
  return rows.length > 0;
}

async function main() {
  const hasApprovedAt = await hasColumn("videos", "approved_at");
  const approvedOrderExpr = hasApprovedAt
    ? "COALESCE(v.approved_at, v.created_at)"
    : "v.created_at";
  const approvedAtSelectExpr = hasApprovedAt
    ? "v.approved_at AS approvedAt"
    : "NULL AS approvedAt";

  const [
    approvedTotalRows,
    approvedPlayableTotalRows,
    pendingTotalRows,
    approvedRawGenreRows,
    newestPlayableRawGenreRows,
    pendingRawGenreRows,
    topUnbucketedApprovedRows,
    topUnknownApprovedRows,
    artistRows,
  ] = await Promise.all([
    query(
      "SELECT COUNT(*) AS total FROM videos WHERE COALESCE(approved, 0) = 1",
    ),
    query(
      `
        SELECT COUNT(*) AS total
        FROM videos v
        WHERE COALESCE(v.approved, 0) = 1
          AND EXISTS (
            SELECT 1
            FROM site_videos sv
            WHERE sv.video_id = v.id
              AND sv.status = 'available'
          )
      `,
    ),
    query(
      "SELECT COUNT(*) AS total FROM videos WHERE COALESCE(approved, 0) = 0",
    ),
    queryRawGenreCounts("COALESCE(v.approved, 0) = 1"),
    query(
      `
        SELECT
          TRIM(COALESCE(x.genre, '')) AS genre,
          COUNT(*) AS total
        FROM (
          SELECT v.genre
          FROM videos v
          WHERE COALESCE(v.approved, 0) = 1
            AND EXISTS (
              SELECT 1
              FROM site_videos sv
              WHERE sv.video_id = v.id
                AND sv.status = 'available'
            )
          ORDER BY ${approvedOrderExpr} DESC, v.id DESC
          LIMIT ?
        ) x
        GROUP BY TRIM(COALESCE(x.genre, ''))
        ORDER BY total DESC, genre ASC
      `,
      [newestWindow],
    ),
    query(
      `
        SELECT
          TRIM(COALESCE(x.genre, '')) AS genre,
          COUNT(*) AS total
        FROM (
          SELECT v.genre
          FROM videos v
          WHERE COALESCE(v.approved, 0) = 0
          ORDER BY v.created_at DESC, v.id DESC
          LIMIT ?
        ) x
        GROUP BY TRIM(COALESCE(x.genre, ''))
        ORDER BY total DESC, genre ASC
      `,
      [pendingWindow],
    ),
    query(
      `
        SELECT
          v.videoId,
          v.title,
          v.parsedArtist,
          v.genre,
          ${approvedAtSelectExpr},
          v.created_at AS createdAt
        FROM videos v
        WHERE COALESCE(v.approved, 0) = 1
          AND v.genre IS NOT NULL
          AND TRIM(v.genre) <> ''
        ORDER BY ${approvedOrderExpr} DESC, v.id DESC
        LIMIT ?
      `,
      [newestWindow],
    ),
    query(
      `
        SELECT
          v.videoId,
          v.title,
          v.parsedArtist,
          v.genre,
          ${approvedAtSelectExpr},
          v.created_at AS createdAt
        FROM videos v
        WHERE COALESCE(v.approved, 0) = 1
          AND (v.genre IS NULL OR TRIM(v.genre) = '')
        ORDER BY ${approvedOrderExpr} DESC, v.id DESC
        LIMIT ?
      `,
      [sampleLimit],
    ),
    query(
      `
        SELECT
          v.videoId,
          v.title,
          v.parsedArtist,
          v.genre,
          v.approved,
          ${approvedAtSelectExpr},
          v.created_at AS createdAt
        FROM videos v
        WHERE LOWER(TRIM(COALESCE(v.parsedArtist, ''))) = LOWER(TRIM(?))
           OR LOWER(COALESCE(v.title, '')) LIKE CONCAT('%', LOWER(TRIM(?)), '%')
        ORDER BY ${approvedOrderExpr} DESC, v.id DESC
        LIMIT ?
      `,
      [artistNeedle, artistNeedle, sampleLimit],
    ),
  ]);

  const approvedBucketSummary = buildBucketSummary(approvedRawGenreRows);
  const newestBucketSummary = buildBucketSummary(newestPlayableRawGenreRows);
  const pendingBucketSummary = buildBucketSummary(pendingRawGenreRows);

  const unbucketedApprovedSample = topRows(
    topUnbucketedApprovedRows.filter((row) => {
      const genre = String(row.genre ?? "").trim();
      return genre.length > 0 && resolveTopLevelGenreBucket(genre) === null;
    }),
    sampleLimit,
  );

  const artistBucketRows = artistRows.map((row) => ({
    ...row,
    resolvedBucket: resolveTopLevelGenreBucket(String(row.genre ?? "")),
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    thresholds: {
      newestWindow,
      pendingWindow,
      sampleLimit,
      artistNeedle,
    },
    totals: {
      approvedVideos: asInt(approvedTotalRows[0]?.total),
      approvedPlayableVideos: asInt(approvedPlayableTotalRows[0]?.total),
      pendingVideos: asInt(pendingTotalRows[0]?.total),
    },
    catalogQuality: {
      bucketCounts: approvedBucketSummary.bucketRows,
      unknownGenreCount: approvedBucketSummary.unknownGenreCount,
      unbucketedKnownGenreCount: approvedBucketSummary.unbucketedKnownGenreCount,
      topRawGenres: topRows(
        approvedRawGenreRows.map((row) => ({
          genre: String(row.genre ?? ""),
          count: asInt(row.total),
          resolvedBucket: resolveTopLevelGenreBucket(String(row.genre ?? "")),
        })),
        sampleLimit,
      ),
      unbucketedKnownGenreSample: unbucketedApprovedSample,
      unknownGenreSample: topUnknownApprovedRows,
    },
    newestPlayableQuality: {
      windowSize: newestWindow,
      bucketCounts: newestBucketSummary.bucketRows,
      unknownGenreCount: newestBucketSummary.unknownGenreCount,
      unbucketedKnownGenreCount: newestBucketSummary.unbucketedKnownGenreCount,
      topRawGenres: topRows(
        newestPlayableRawGenreRows.map((row) => ({
          genre: String(row.genre ?? ""),
          count: asInt(row.total),
          resolvedBucket: resolveTopLevelGenreBucket(String(row.genre ?? "")),
        })),
        sampleLimit,
      ),
    },
    pendingQuality: {
      windowSize: pendingWindow,
      bucketCounts: pendingBucketSummary.bucketRows,
      unknownGenreCount: pendingBucketSummary.unknownGenreCount,
      unbucketedKnownGenreCount: pendingBucketSummary.unbucketedKnownGenreCount,
      topRawGenres: topRows(
        pendingRawGenreRows.map((row) => ({
          genre: String(row.genre ?? ""),
          count: asInt(row.total),
          resolvedBucket: resolveTopLevelGenreBucket(String(row.genre ?? "")),
        })),
        sampleLimit,
      ),
    },
    artistSpotCheck: {
      artistNeedle,
      matchCount: artistBucketRows.length,
      rows: artistBucketRows,
    },
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("Genre quality audit complete.");
  console.log(`Report: ${outPath}`);
  console.log("");
  console.log("Catalog bucket totals:");
  for (const row of approvedBucketSummary.bucketRows) {
    console.log(`- ${row.name}: ${row.count}`);
  }
  console.log(`- unknown/unclassified: ${approvedBucketSummary.unknownGenreCount}`);
  console.log(`- known but unbucketed: ${approvedBucketSummary.unbucketedKnownGenreCount}`);
  console.log("");
  console.log(`Artist spot check (${artistNeedle}): ${artistBucketRows.length} rows`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.end();
    } catch {
      // Connection may never open when DB is unreachable.
    }
  });
