#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

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
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (!found) return fallback;
  return found.slice(prefix.length);
}

loadDatabaseEnv();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const intervalMs = Math.max(1000, Number(parseArg("interval-ms", "5000")));

const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  connectionLimit: 2,
  decimalNumbers: true,
  supportBigNumbers: true,
});

let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});

async function readState() {
  const [stateRows] = await pool.query(
    `SELECT status, total_videos, last_video_id, processed_count, updated_count, deleted_count, queued_count, started_at, updated_at, last_message
     FROM admin_genre_reclassify_state
     WHERE id = 1
     LIMIT 1`
  );

  const [queueRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM admin_genre_review_queue`
  );

  const row = stateRows[0] || null;
  const queueTotal = Number(queueRows[0]?.total || 0);

  if (!row) {
    return {
      status: "missing",
      queueTotal,
      totalVideos: 0,
      processedCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      queuedCount: 0,
      lastVideoId: 0,
      lastMessage: null,
      startedAt: null,
      updatedAt: null,
    };
  }

  return {
    status: String(row.status || "unknown"),
    queueTotal,
    totalVideos: Number(row.total_videos || 0),
    processedCount: Number(row.processed_count || 0),
    updatedCount: Number(row.updated_count || 0),
    deletedCount: Number(row.deleted_count || 0),
    queuedCount: Number(row.queued_count || 0),
    lastVideoId: Number(row.last_video_id || 0),
    lastMessage: row.last_message || null,
    startedAt: row.started_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function main() {
  console.log(`[genre-reclassify-watch] polling every ${intervalMs}ms`);

  while (!stopped) {
    const state = await readState();
    const pct = state.totalVideos > 0 ? ((state.processedCount / state.totalVideos) * 100).toFixed(2) : "0.00";

    console.log(
      `[${new Date().toISOString()}] status=${state.status} progress=${state.processedCount}/${state.totalVideos} (${pct}%) updated=${state.updatedCount} deleted=${state.deletedCount} queuedByWorker=${state.queuedCount} queueRemaining=${state.queueTotal} lastId=${state.lastVideoId}`,
    );

    if (state.lastMessage) {
      console.log(`  last: ${state.lastMessage}`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main()
  .catch((error) => {
    console.error("[genre-reclassify-watch] fatal:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
