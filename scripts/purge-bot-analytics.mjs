#!/usr/bin/env node

/**
 * Purge historical suspected-bot rows from analytics_events.
 *
 * The behavioural classifier correctly marks ~78% of analytics_events as
 * `is_suspected_bot = 1`, but the dashboard maintenance job still scans and
 * aggregates over the full table every tick. Deleting old bot rows shrinks the
 * table and permanently reduces that cost (and the bot-classifier UPDATE's
 * cost) — without losing any chart fidelity, because downstream rollups and
 * series already exclude suspected-bot rows.
 *
 * A recent window is retained by default so the rolling 7-day classifier can
 * still graduate a real visitor back out of the suspected set.
 *
 * Usage (run from the repo root):
 *   node scripts/purge-bot-analytics.mjs                 # dry-run
 *   node scripts/purge-bot-analytics.mjs --apply         # delete + refresh rollups/cache
 *   node scripts/purge-bot-analytics.mjs --keep-days=14 --apply
 *
 * Requires DATABASE_URL in the environment (loads apps/web/.env.local and .env
 * as a convenience for local runs; in production set it explicitly or run via
 * the same environment the maintenance timer uses).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import dotenv from "dotenv";

import { maintainAdminDashboardCache } from "./maintain-admin-dashboard-cache.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try { dotenv.config({ path: path.resolve(__dirname, "../apps/web/.env.local") }); } catch { /* optional */ }
try { dotenv.config(); } catch { /* optional */ }

const DEFAULT_KEEP_DAYS = 14;

function toKeepDays(value) {
  const n = Math.trunc(Number(value));
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid --keep-days value: ${String(value)}`);
  }
  return n;
}

function parseArgs(argv) {
  let apply = false;
  let keepDays = DEFAULT_KEEP_DAYS;

  for (const arg of argv) {
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/purge-bot-analytics.mjs [--apply] [--keep-days=N]",
          "",
          "  --apply          delete the rows (default is dry-run)",
          `  --keep-days=N    retain suspected-bot rows newer than N days (default ${DEFAULT_KEEP_DAYS})`,
          "",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      const match = /^--keep-days=(\d+)$/.exec(arg);
      if (match) {
        keepDays = toKeepDays(match[1]);
      } else {
        throw new Error(`Unknown argument: ${arg}`);
      }
    }
  }

  return { apply, keepDays };
}

function buildDeleteSql(keepDays) {
  const days = Math.trunc(Number(keepDays));
  // Only the integer is interpolated; validated above.
  return `
    DELETE FROM analytics_events
    WHERE is_suspected_bot = 1
      AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${days} DAY)
  `;
}

async function countRows(client, keepDays) {
  const rows = await client.$queryRawUnsafe(`
    SELECT COUNT(*) AS c
    FROM analytics_events
    WHERE is_suspected_bot = 1
      AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${Math.trunc(Number(keepDays))} DAY)
  `);
  return Number(rows[0]?.c ?? 0);
}

async function main() {
  const { apply, keepDays } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. Cannot purge without a database.");
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

  try {
    const candidates = await countRows(prisma, keepDays);

    if (!apply) {
      console.log(`Dry run — retain suspected-bot rows newer than ${keepDays} days`);
      console.log(`  rows eligible for deletion: ${candidates}`);
      console.log("No changes written. Re-run with --apply to commit.");
      return;
    }

    const affected = await prisma.$executeRawUnsafe(buildDeleteSql(keepDays));
    console.log(`Purged suspected-bot analytics rows older than ${keepDays} days.`);
    console.log(`  expected ${candidates} rows, deleted ${Number(affected ?? 0)} rows.`);
  } finally {
    await prisma.$disconnect();
  }

  // Refresh the rollup tables and dashboard cache so charts reflect the
  // (unchanged — bot rows were already excluded) but smaller table cleanly.
  console.log("Refreshing rollup tables and dashboard cache...");
  await maintainAdminDashboardCache();
  console.log("Done.");
}

main().catch((error) => {
  console.error("purge-bot-analytics failed:", error);
  process.exit(1);
});
