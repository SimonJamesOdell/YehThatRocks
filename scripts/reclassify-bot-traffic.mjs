#!/usr/bin/env node

/**
 * One-off bot-traffic reclassification.
 *
 * The 5-minute maintenance job only reclassifies the rolling 7-day window, so
 * rows from an earlier attack episode keep their stale `is_suspected_bot` flag
 * once they age out of the window. This script runs the same behavioural
 * classifier (scripts/lib/bot-classifier-sql.mjs) over a wider window to
 * retroactively correct the traffic chart, then refreshes the rollup tables and
 * dashboard cache.
 *
 * Usage (run from the repo root):
 *   node scripts/reclassify-bot-traffic.mjs                # dry-run, 30-day window
 *   node scripts/reclassify-bot-traffic.mjs --apply        # write + refresh rollups/cache
 *   node scripts/reclassify-bot-traffic.mjs --days=45 --apply
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

import { buildBotClassificationSql, BOT_CLASSIFY_WINDOW_DAYS } from "./lib/bot-classifier-sql.mjs";
import { maintainAdminDashboardCache } from "./maintain-admin-dashboard-cache.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try { dotenv.config({ path: path.resolve(__dirname, "../apps/web/.env.local") }); } catch { /* optional */ }
try { dotenv.config(); } catch { /* optional */ }

const DEFAULT_WINDOW_DAYS = 30;

function toWindowDays(value) {
  const n = Math.trunc(Number(value));
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid --days value: ${String(value)}`);
  }
  return n;
}

function parseArgs(argv) {
  let apply = false;
  let days = DEFAULT_WINDOW_DAYS;

  for (const arg of argv) {
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/reclassify-bot-traffic.mjs [--apply] [--days=N]",
          "",
          "  --apply     write the reclassification (default is dry-run)",
          `  --days=N    window in days (default ${DEFAULT_WINDOW_DAYS}; maintenance tick uses ${BOT_CLASSIFY_WINDOW_DAYS})`,
          "",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      const match = /^--days=(\d+)$/.exec(arg);
      if (match) {
        days = toWindowDays(match[1]);
      } else {
        throw new Error(`Unknown argument: ${arg}`);
      }
    }
  }

  return { apply, days };
}

async function countCleanEvents(client, days) {
  const rows = await client.$queryRawUnsafe(`
    SELECT COUNT(*) AS c
    FROM analytics_events
    WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${Math.trunc(Number(days))} DAY)
      AND is_suspected_bot = 0
      AND manually_excluded = 0
  `);
  return Number(rows[0]?.c ?? 0);
}

async function main() {
  const { apply, days } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. Cannot reclassify without a database.");
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });
  const sql = buildBotClassificationSql(days);

  try {
    const before = await countCleanEvents(prisma, days);

    if (!apply) {
      let after = before;
      let affected = 0;
      try {
        await prisma.$transaction(
          async (tx) => {
            affected = Number((await tx.$executeRawUnsafe(sql)) ?? 0);
            after = await countCleanEvents(tx, days);
            throw new Error("__DRY_RUN_ROLLBACK__");
          },
          { timeout: 180_000 },
        );
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "__DRY_RUN_ROLLBACK__") {
          throw error;
        }
      }

      console.log(`Dry run — window: last ${days} days`);
      console.log(`  clean events in window (before): ${before}`);
      console.log(`  clean events in window (after):  ${after}`);
      console.log(`  rows the UPDATE would touch:     ${affected}`);
      console.log("No changes written. Re-run with --apply to commit.");
      return;
    }

    const affected = await prisma.$executeRawUnsafe(sql);
    const after = await countCleanEvents(prisma, days);
    console.log(`Applied bot reclassification over last ${days} days.`);
    console.log(`  clean events in window: ${before} -> ${after}`);
    console.log(`  UPDATE touched ${Number(affected ?? 0)} rows.`);
  } finally {
    await prisma.$disconnect();
  }

  // Refresh the rollup tables and the dashboard cache so the corrected flags are
  // reflected immediately — identical to what the 5-minute maintenance tick runs.
  console.log("Refreshing rollup tables and dashboard cache...");
  await maintainAdminDashboardCache();
  console.log("Done.");
}

main().catch((error) => {
  console.error("reclassify-bot-traffic failed:", error);
  process.exit(1);
});
