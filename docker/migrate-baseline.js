#!/usr/bin/env node
// One-time migration baseline: if _prisma_migrations does not yet exist, marks all
// pre-existing migrations as already applied so that `prisma migrate deploy` won't
// attempt to re-run them on an existing database.
//
// Safe to run on every boot — exits immediately when _prisma_migrations already exists.
'use strict';

const { execSync } = require('child_process');

// All migrations that were applied to the DB before the prisma migrate workflow
// was established (via db push or manual SQL). Order must be chronological.
const BASELINE_MIGRATIONS = [
  '20260402_auth_sessions_and_audit_logs',
  '20260403_video_metadata_enrichment',
  '20260404_artist_stats_projection',
  '20260404_artist_stats_thumbnails',
  '20260404_artist_video_query_index',
  '20260405_genre_cards',
  '20260406_user_profile_fields',
  '20260410_watch_history',
];

async function migrationsTableExists() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1 FROM _prisma_migrations LIMIT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const exists = await migrationsTableExists();
  if (exists) {
    console.log('[migrate-baseline] Migration history exists — skipping baseline.');
    return;
  }

  console.log('[migrate-baseline] No migration history found. Resolving baseline migrations as applied...');

  for (const name of BASELINE_MIGRATIONS) {
    console.log(`[migrate-baseline] Resolving: ${name}`);
    execSync(
      `npx prisma migrate resolve --applied ${name} --schema /app/prisma/schema.prisma`,
      { stdio: 'inherit' }
    );
  }

  console.log('[migrate-baseline] Baseline complete — all existing migrations marked as applied.');
}

main().catch((err) => {
  console.error('[migrate-baseline] Fatal error:', err);
  process.exit(1);
});
