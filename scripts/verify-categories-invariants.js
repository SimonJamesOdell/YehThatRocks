#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
const { isRockMetalGenre } = require("./lib/genre-scope");
const { assertInvariant, finishInvariantCheck } = require("./lib/test-harness");
const { asNumber, readArg } = require("./lib/cli");

function loadDatabaseEnv() {
  const envPath = path.resolve(process.cwd(), "apps/web/.env.local");
  if (!fs.existsSync(envPath)) {
    return;
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

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getInvariantDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return databaseUrl;
  }

  try {
    const url = new URL(databaseUrl);
    if (!url.searchParams.has("connectionLimit")) {
      url.searchParams.set("connectionLimit", process.env.PRISMA_CONNECTION_LIMIT || "10");
    }
    if (!url.searchParams.has("acquireTimeout")) {
      url.searchParams.set("acquireTimeout", process.env.PRISMA_POOL_TIMEOUT_MS || "30000");
    }
    if (!url.searchParams.has("connectTimeout")) {
      url.searchParams.set("connectTimeout", process.env.PRISMA_CONNECT_TIMEOUT_MS || "5000");
    }

    return url.toString();
  } catch {
    return databaseUrl;
  }
}

function getMySqlConnectionConfig() {
  const databaseUrl = getInvariantDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }

  const parsed = new URL(databaseUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
    connectTimeout: Number(parsed.searchParams.get("connectTimeout") || 5000),
  };
}

function isTransientPoolError(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("pool timeout")
    || error.message.includes("failed to retrieve a connection from pool")
    || error.message.includes("Connection timed out")
  );
}

async function queryWithRetry(runQuery, queryName, attempts = 3) {
  let attempt = 1;
  let waitMs = 400;

  while (attempt <= attempts) {
    try {
      return await runQuery();
    } catch (error) {
      const retryable = isTransientPoolError(error);
      if (!retryable || attempt >= attempts) {
        throw error;
      }

      console.warn(`[warn] ${queryName} transient DB timeout (attempt ${attempt}/${attempts}); retrying in ${waitMs}ms`);
      await sleep(waitMs);
      waitMs *= 2;
      attempt += 1;
    }
  }

  throw new Error(`Unexpected retry state for ${queryName}`);
}

async function runSqlQuery(connection, sql) {
  const [rows] = await connection.query(sql);
  return rows;
}

function getGenreSlug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function runApiChecks({ baseUrl, maxApiDurationMs, minCoverage }, failures) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/categories`;
  const startedAt = Date.now();

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    failures.push({
      description: "API /api/categories reachable",
      details: `request failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    console.error("[fail] API /api/categories reachable");
    return;
  }

  const networkDurationMs = Date.now() - startedAt;
  assertInvariant(response.ok, "API /api/categories returns 2xx", `status=${response.status}`, failures);

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    failures.push({
      description: "API /api/categories returns valid JSON",
      details: error instanceof Error ? error.message : String(error),
    });
    console.error("[fail] API /api/categories returns valid JSON");
    return;
  }

  const categories = Array.isArray(payload?.categories) ? payload.categories : [];
  const count = Number(payload?.meta?.count ?? 0);
  const durationMs = Number(payload?.meta?.durationMs ?? NaN);
  const withThumb = categories.filter(
    (entry) => typeof entry?.previewVideoId === "string" && /^[A-Za-z0-9_-]{11}$/.test(entry.previewVideoId),
  ).length;

  assertInvariant(categories.length === count, "API meta count matches payload size", `meta.count=${count} categories=${categories.length}`, failures);
  assertInvariant(
    Number.isFinite(durationMs) && durationMs <= maxApiDurationMs,
    "API reports fast compute duration",
    `durationMs=${durationMs} max=${maxApiDurationMs}`,
    failures,
  );
  assertInvariant(networkDurationMs <= Math.max(maxApiDurationMs * 4, 1200), "API network response is responsive", `networkMs=${networkDurationMs}`, failures);

  const coverage = categories.length > 0 ? withThumb / categories.length : 0;
  assertInvariant(
    coverage >= minCoverage,
    "API thumbnail coverage meets threshold",
    `coverage=${(coverage * 100).toFixed(2)}% threshold=${(minCoverage * 100).toFixed(2)}%`,
    failures,
  );

  if (categories.length === 0) {
    assertInvariant(true, "API category slug checks skipped when no categories exist", "", failures);
    return;
  }

  const firstGenre = String(categories[0]?.genre ?? "").trim();
  const firstSlug = getGenreSlug(firstGenre);
  assertInvariant(Boolean(firstSlug), "API category slug derivation yields non-empty slug", `genre=${firstGenre}`, failures);
  if (!firstSlug) {
    return;
  }

  const categoryUrl = `${baseUrl.replace(/\/$/, "")}/api/categories/${encodeURIComponent(firstSlug)}?limit=24&offset=0`;
  let categoryResponse;
  try {
    categoryResponse = await fetch(categoryUrl, {
      method: "GET",
      headers: {
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    failures.push({
      description: "API /api/categories/[slug] reachable",
      details: `request failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    console.error("[fail] API /api/categories/[slug] reachable");
    return;
  }

  assertInvariant(
    categoryResponse.status !== 500,
    "API /api/categories/[slug] never returns raw 500",
    `status=${categoryResponse.status}`,
    failures,
  );

  let categoryPayload;
  try {
    categoryPayload = await categoryResponse.json();
  } catch (error) {
    failures.push({
      description: "API /api/categories/[slug] returns valid JSON",
      details: error instanceof Error ? error.message : String(error),
    });
    console.error("[fail] API /api/categories/[slug] returns valid JSON");
    return;
  }

  if (categoryResponse.status === 200) {
    assertInvariant(typeof categoryPayload?.genre === "string" && categoryPayload.genre.length > 0, "API /api/categories/[slug] returns canonical genre name", `genre=${String(categoryPayload?.genre)}`, failures);
    assertInvariant(Array.isArray(categoryPayload?.videos), "API /api/categories/[slug] returns videos array", `videosType=${typeof categoryPayload?.videos}`, failures);
    assertInvariant(typeof categoryPayload?.hasMore === "boolean", "API /api/categories/[slug] returns hasMore boolean", `hasMore=${String(categoryPayload?.hasMore)}`, failures);
    assertInvariant(Number.isFinite(Number(categoryPayload?.nextOffset)), "API /api/categories/[slug] returns numeric nextOffset", `nextOffset=${String(categoryPayload?.nextOffset)}`, failures);
  } else {
    assertInvariant(categoryResponse.status === 503, "API /api/categories/[slug] hard-fails with 503 when canonical data is unavailable", `status=${categoryResponse.status}`, failures);
    assertInvariant(
      categoryPayload?.error === "The system cannot serve this request right now. Please try again later.",
      "API /api/categories/[slug] returns explicit retry message on hard-fail",
      `error=${String(categoryPayload?.error)}`,
      failures,
    );
  }
}

async function main() {
  if (hasFlag("help")) {
    console.log([
      "Usage: node scripts/verify-categories-invariants.js [options]",
      "",
      "Options:",
      "  --check-api                 Also verify live /api/categories endpoint",
      "  --base-url=http://localhost:3000",
      "  --min-coverage=0.94         Minimum required thumbnail coverage",
      "  --max-api-duration-ms=350   Max API-reported compute duration",
      "  --help",
    ].join("\n"));
    process.exit(0);
  }

  loadDatabaseEnv();

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Add it to apps/web/.env.local or your shell.");
    process.exit(1);
  }

  const checkApi = hasFlag("check-api");
  const baseUrl = readArg("base-url", "http://localhost:3000");
  const minCoverage = asNumber(readArg("min-coverage", "0.94"), 0.94);
  const maxApiDurationMs = asNumber(readArg("max-api-duration-ms", "350"), 350);

  const mysqlConfig = getMySqlConnectionConfig();
  if (!mysqlConfig) {
    console.error("DATABASE_URL is not set. Add it to apps/web/.env.local or your shell.");
    process.exit(1);
  }

  const connection = await mysql.createConnection(mysqlConfig);
  const failures = [];

  try {
    const genreCountRows = await queryWithRetry(
      () => runSqlQuery(connection, "SELECT COUNT(*) AS count FROM genres WHERE name IS NOT NULL AND TRIM(name) <> ''"),
      "genres count",
    );
    const cardCountRows = await queryWithRetry(
      () => runSqlQuery(connection, "SELECT COUNT(*) AS count FROM genre_cards"),
      "genre_cards count",
    );
    const duplicateRows = await queryWithRetry(
      () => runSqlQuery(connection, `
        SELECT genre, COUNT(*) AS c
        FROM genre_cards
        GROUP BY genre
        HAVING COUNT(*) > 1
      `),
      "duplicate genre rows",
    );
    const invalidVideoIdRows = await queryWithRetry(
      () => runSqlQuery(connection, `
        SELECT genre, thumbnail_video_id AS thumbnailVideoId
        FROM genre_cards
        WHERE thumbnail_video_id IS NOT NULL
          AND thumbnail_video_id NOT REGEXP '^[A-Za-z0-9_-]{11}$'
        LIMIT 20
      `),
      "invalid thumbnail IDs",
    );
    const unavailableThumbRows = await queryWithRetry(
      () => runSqlQuery(connection, `
        SELECT gc.genre, gc.thumbnail_video_id AS thumbnailVideoId
        FROM genre_cards gc
        LEFT JOIN videos v
          ON CONVERT(v.videoId USING utf8mb4) = CONVERT(gc.thumbnail_video_id USING utf8mb4)
        LEFT JOIN site_videos sv
          ON sv.video_id = v.id
        WHERE gc.thumbnail_video_id IS NOT NULL
          AND gc.thumbnail_video_id <> ''
          AND (v.id IS NULL OR sv.status <> 'available')
        LIMIT 20
      `),
      "unavailable thumbnail videos",
    );
    const withThumbRows = await queryWithRetry(
      () => runSqlQuery(connection, `
        SELECT COUNT(*) AS count
        FROM genre_cards
        WHERE thumbnail_video_id IS NOT NULL
          AND thumbnail_video_id <> ''
      `),
      "thumbnail coverage count",
    );
    const canonicalGenreRows = await queryWithRetry(
      () => runSqlQuery(connection, `
        SELECT name
        FROM genres
        WHERE name IS NOT NULL AND TRIM(name) <> ''
      `),
      "canonical genre rows",
    );
    const cardGenreRows = await queryWithRetry(
      () => runSqlQuery(connection, `
        SELECT genre
        FROM genre_cards
        WHERE genre IS NOT NULL AND TRIM(genre) <> ''
      `),
      "genre_cards genre rows",
    );

    const genreCount = Number(genreCountRows[0]?.count ?? 0);
    const cardCount = Number(cardCountRows[0]?.count ?? 0);
    const withThumb = Number(withThumbRows[0]?.count ?? 0);
    const coverage = cardCount > 0 ? withThumb / cardCount : 0;
    const nonScopedCanonicalGenres = canonicalGenreRows
      .map((row) => String(row.name).trim())
      .filter((genre) => genre && !isRockMetalGenre(genre));
    const nonScopedCardGenres = cardGenreRows
      .map((row) => String(row.genre).trim())
      .filter((genre) => genre && !isRockMetalGenre(genre));

    console.log("Categories invariant audit\n");
    console.log(`genres=${genreCount} genre_cards=${cardCount} with_thumb=${withThumb} coverage=${(coverage * 100).toFixed(2)}%\n`);

    assertInvariant(cardCount === genreCount, "genre_cards row count matches canonical genres", `genres=${genreCount} cards=${cardCount}`, failures);
    assertInvariant(duplicateRows.length === 0, "No duplicate genres in genre_cards", duplicateRows.length ? `examples=${JSON.stringify(duplicateRows.slice(0, 3))}` : "", failures);
    assertInvariant(invalidVideoIdRows.length === 0, "All thumbnail_video_id values use valid YouTube ID format", invalidVideoIdRows.length ? `examples=${JSON.stringify(invalidVideoIdRows.slice(0, 3))}` : "", failures);
    assertInvariant(unavailableThumbRows.length === 0, "All stored thumbnail videos resolve to available site_videos", unavailableThumbRows.length ? `examples=${JSON.stringify(unavailableThumbRows.slice(0, 3))}` : "", failures);
    assertInvariant(
      nonScopedCanonicalGenres.length === 0,
      "Canonical genres are strictly rock/metal scoped",
      nonScopedCanonicalGenres.length ? `examples=${JSON.stringify(nonScopedCanonicalGenres.slice(0, 8))}` : "",
      failures,
    );
    assertInvariant(
      nonScopedCardGenres.length === 0,
      "genre_cards rows are strictly rock/metal scoped",
      nonScopedCardGenres.length ? `examples=${JSON.stringify(nonScopedCardGenres.slice(0, 8))}` : "",
      failures,
    );
    assertInvariant(
      coverage >= minCoverage,
      "Thumbnail coverage meets threshold",
      `coverage=${(coverage * 100).toFixed(2)}% threshold=${(minCoverage * 100).toFixed(2)}%`,
      failures,
    );

    if (checkApi) {
      console.log("\nRunning live API checks\n");
      await runApiChecks({ baseUrl, maxApiDurationMs, minCoverage }, failures);
    }

    finishInvariantCheck({
      failures,
      failureHeader: `\nInvariant check failed: ${failures.length} issue(s).`,
      successMessage: "\nAll category invariants passed.",
    });
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error("Fatal error in category invariant checker:", error);
  process.exit(1);
});
