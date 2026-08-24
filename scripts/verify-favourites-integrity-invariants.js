#!/usr/bin/env node

// Domain: Favourites data integrity + vote-fraud hardening.
//
// The audit found updateFavourite() used a check-then-insert pattern that can
// race into duplicate rows under concurrent requests, with no unique constraint
// and no rate limiting on the mutation endpoint. This invariant guards:
//   - the schema unique constraint on (userid, videoId)
//   - the dedupe + unique-index migration
//   - the atomic createMany(skipDuplicates) upsert in updateFavourite
//   - the rate limit on the favourites POST endpoint

const path = require("node:path");
const {
  readFileStrict,
  mapRelativeFiles,
  assertFilesExist,
  assertContains,
  finishInvariantCheck,
} = require("./lib/test-harness");

const ROOT = process.cwd();

const files = mapRelativeFiles(ROOT, {
  schema: "prisma/schema.prisma",
  migration: "prisma/migrations/20260823000000_add_favourites_unique_constraint/migration.sql",
  catalogData: "apps/web/lib/catalog-data-videos.ts",
  favouritesRoute: "apps/web/app/api/favourites/route.ts",
});

function main() {
  const failures = [];

  assertFilesExist(files, failures, ROOT);

  // ── 1. Schema unique constraint ───────────────────────────────────────
  const schema = readFileStrict(files.schema, ROOT);
  assertContains(schema, '@@unique([userid, videoId], map: "uq_favourite_user_video")', "schema declares a unique (userid, videoId) constraint on favourites", failures);

  // ── 2. Migration dedupes then adds the unique index ───────────────────
  const migration = readFileStrict(files.migration, ROOT);
  assertContains(migration, "DELETE", "migration deduplicates existing favourite rows", failures);
  assertContains(migration, "uq_favourite_user_video", "migration adds the unique index", failures);
  assertContains(migration, "UNIQUE INDEX", "migration uses a UNIQUE INDEX", failures);

  // ── 3. Atomic upsert in updateFavourite ────────────────────────────────
  const catalog = readFileStrict(files.catalogData, ROOT);
  assertContains(catalog, "createMany", "updateFavourite uses createMany (atomic)", failures);
  assertContains(catalog, "skipDuplicates: true", "updateFavourite is idempotent via skipDuplicates", failures);

  // ── 4. Rate limit on the favourites mutation ───────────────────────────
  const route = readFileStrict(files.favouritesRoute, ROOT);
  assertContains(route, "rateLimitOrResponse", "favourites POST applies rate limiting", failures);

  finishInvariantCheck({
    failures,
    failureHeader: "\nFavourites integrity invariants FAILED:",
    successMessage: "\nAll favourites integrity invariants passed.",
  });
}

main();
