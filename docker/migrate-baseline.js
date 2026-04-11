#!/usr/bin/env node
// One-time migration baseline: if _prisma_migrations does not yet exist, marks all
// pre-existing migrations as already applied so that `prisma migrate deploy` won't
// attempt to re-run them on an existing database.
//
// Safe to run on every boot — exits immediately when _prisma_migrations already exists.
'use strict';

const { execSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

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

function getDatabaseNameFromUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('DATABASE_URL is not set');
  }
  const url = new URL(raw);
  return url.pathname.replace(/^\//, '') || 'yeh';
}

async function tableExists(prisma, dbName, tableName) {
  const rows = await prisma.$queryRaw`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = ${dbName} AND table_name = ${tableName}
    LIMIT 1
  `;
  return Array.isArray(rows) && rows.length > 0;
}

async function columnExists(prisma, dbName, tableName, columnName) {
  const rows = await prisma.$queryRaw`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = ${dbName}
      AND table_name = ${tableName}
      AND column_name = ${columnName}
    LIMIT 1
  `;
  return Array.isArray(rows) && rows.length > 0;
}

async function getAppliedMigrationNames(prisma) {
  const rows = await prisma.$queryRaw`SELECT migration_name FROM _prisma_migrations`;
  return new Set(rows.map((row) => row.migration_name));
}

async function migrationArtifactExists(prisma, dbName, migrationName) {
  switch (migrationName) {
    case '20260402_auth_sessions_and_audit_logs':
      return (
        (await columnExists(prisma, dbName, 'users', 'email_verified_at')) &&
        (await tableExists(prisma, dbName, 'auth_sessions')) &&
        (await tableExists(prisma, dbName, 'auth_audit_logs')) &&
        (await tableExists(prisma, dbName, 'email_verification_tokens')) &&
        (await tableExists(prisma, dbName, 'password_reset_tokens'))
      );
    case '20260403_video_metadata_enrichment':
      return columnExists(prisma, dbName, 'videos', 'parsedArtist');
    case '20260404_artist_stats_projection':
      return tableExists(prisma, dbName, 'artist_stats');
    case '20260404_artist_stats_thumbnails':
      return columnExists(prisma, dbName, 'artist_stats', 'thumbnail_video_id');
    case '20260404_artist_video_query_index':
      return columnExists(prisma, dbName, 'videos', 'parsedArtist');
    case '20260405_genre_cards':
      return tableExists(prisma, dbName, 'genre_cards');
    case '20260406_user_profile_fields':
      return (
        (await columnExists(prisma, dbName, 'users', 'bio')) &&
        (await columnExists(prisma, dbName, 'users', 'location'))
      );
    case '20260410_watch_history':
      return tableExists(prisma, dbName, 'watch_history');
    default:
      return false;
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const dbName = getDatabaseNameFromUrl();
    const hasMigrationsTable = await tableExists(prisma, dbName, '_prisma_migrations');
    const applied = hasMigrationsTable ? await getAppliedMigrationNames(prisma) : new Set();
    let resolved = 0;

    if (!hasMigrationsTable) {
      console.log('[migrate-baseline] No migration history found. Checking legacy artifacts to resolve baseline migrations...');
    }

    for (const name of BASELINE_MIGRATIONS) {
      if (applied.has(name)) {
        continue;
      }
      const artifactExists = await migrationArtifactExists(prisma, dbName, name);
      if (!artifactExists) {
        console.log(`[migrate-baseline] Not present in schema yet: ${name} (will be handled by migrate deploy).`);
        continue;
      }

      console.log(`[migrate-baseline] Resolving as applied: ${name}`);
      execSync(
        `npx prisma migrate resolve --applied ${name} --schema /app/prisma/schema.prisma`,
        { stdio: 'inherit' }
      );
      resolved += 1;
    }

    if (resolved === 0) {
      console.log('[migrate-baseline] Baseline reconciliation complete — nothing to resolve.');
      return;
    }

    console.log(`[migrate-baseline] Baseline reconciliation complete — resolved ${resolved} migration(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[migrate-baseline] Fatal error:', err);
  process.exit(1);
});
