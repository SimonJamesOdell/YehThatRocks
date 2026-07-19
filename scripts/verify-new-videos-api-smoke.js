#!/usr/bin/env node
"use strict";

const path = require("node:path");
const mysql = require("mysql2/promise");

const { assertInvariant } = require("./smoke-assertions");
const { asNumber, readArg } = require("./lib/cli");
const { loadDatabaseEnv } = require("./lib/runtime");

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Cache-Control": "no-cache",
      },
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return { response, payload };
  } finally {
    clearTimeout(timeoutId);
  }
}

function toVideoIds(videos) {
  if (!Array.isArray(videos)) {
    return [];
  }

  return videos
    .map((video) => String(video?.id || "").trim())
    .filter((id) => id.length > 0);
}

async function main() {
  const baseUrl = readArg("base-url", "http://localhost:3000").replace(/\/$/, "");
  const timeoutMs = Math.max(1000, asNumber(readArg("timeout-ms", "15000"), 15000));
  const take = Math.max(1, Math.min(200, asNumber(readArg("take", "20"), 20)));
  const failures = [];

  if (!process.env.DATABASE_URL) {
    loadDatabaseEnv({
      candidateEnvPaths: [
        path.resolve(process.cwd(), "apps/web/.env.local"),
        path.resolve(process.cwd(), ".env.local"),
        path.resolve(process.cwd(), "apps/web/.env.production"),
        path.resolve(process.cwd(), ".env.production"),
      ],
    });
  }

  console.log("New videos API semantic smoke check\n");
  console.log(`baseUrl=${baseUrl} timeoutMs=${timeoutMs} take=${take}`);

  assertInvariant(Boolean(process.env.DATABASE_URL), "DATABASE_URL is available for DB comparison", "DATABASE_URL is not set", failures);

  let apiIds = [];
  const apiUrl = `${baseUrl}/api/videos/newest?skip=0&take=${take}`;
  const apiResult = await fetchJson(apiUrl, timeoutMs).catch((error) => ({ error }));

  if (apiResult?.error) {
    assertInvariant(false, "Newest API endpoint reachable", String(apiResult.error), failures);
  } else {
    const { response, payload } = apiResult;
    const videos = Array.isArray(payload?.videos) ? payload.videos : [];
    apiIds = toVideoIds(videos);

    assertInvariant(response.ok, "Newest API returns 2xx", `status=${response.status}`, failures);
    assertInvariant(payload?.ok === true, "Newest API returns ok=true", `ok=${String(payload?.ok)}`, failures);
    assertInvariant(apiIds.length > 0, "Newest API returns at least one video", `count=${apiIds.length}`, failures);
  }

  let dbIds = [];
  if (process.env.DATABASE_URL) {
    const dbSql = `
      SELECT v.videoId
      FROM videos v
      WHERE COALESCE(v.approved, 0) = 1
        AND v.approved_at IS NOT NULL
      ORDER BY v.approved_at DESC, v.id DESC
      LIMIT ${take}
    `;

    const connection = await mysql.createConnection(process.env.DATABASE_URL);
    try {
      const [rows] = await connection.execute(dbSql);
      dbIds = rows.map((row) => String(row.videoId));
    } finally {
      await connection.end();
    }
  }

  assertInvariant(dbIds.length > 0, "DB newest-approved query returns at least one row", `count=${dbIds.length}`, failures);

  const compareLength = Math.min(apiIds.length, dbIds.length);
  const mismatches = [];
  for (let i = 0; i < compareLength; i += 1) {
    if (apiIds[i] !== dbIds[i]) {
      mismatches.push({ position: i + 1, api: apiIds[i], db: dbIds[i] });
    }
  }

  assertInvariant(
    apiIds.length === dbIds.length,
    "Newest API and DB return the same row count for top N",
    `api=${apiIds.length} db=${dbIds.length}`,
    failures,
  );

  assertInvariant(
    mismatches.length === 0,
    "Newest API ordering matches DB approved_at DESC ordering",
    mismatches.length > 0 ? `firstMismatch=${JSON.stringify(mismatches[0])}` : "",
    failures,
  );

  if (failures.length > 0) {
    console.error("\nNew videos API semantic smoke check failed:");
    for (const failure of failures) {
      console.error(`- ${failure.description}${failure.details ? ` (${failure.details})` : ""}`);
    }
    process.exit(1);
  }

  console.log("\nNew videos API semantic smoke check passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
