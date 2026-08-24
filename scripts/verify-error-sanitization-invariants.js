#!/usr/bin/env node

// Domain: API error handling — no raw database/driver error leakage to clients.
//
// Guards the single sanitization choke point (lib/api-error.ts) and the routes
// that previously returned `error.message` verbatim (Prisma/driver messages
// contain table/constraint names, SQL fragments, and connection config — an
// information-disclosure vector). New routes must use safeErrorMessage instead
// of inlining `error instanceof Error ? error.message`.

const path = require("node:path");
const {
  readFileStrict,
  mapRelativeFiles,
  assertFilesExist,
  assertContains,
  assertNotContains,
  finishInvariantCheck,
} = require("./lib/test-harness");

const ROOT = process.cwd();

const files = mapRelativeFiles(ROOT, {
  apiError: "apps/web/lib/api-error.ts",
  newest: "apps/web/app/api/videos/newest/route.ts",
  newestFacets: "apps/web/app/api/videos/newest/facets/route.ts",
  categories: "apps/web/app/api/categories/route.ts",
  facebookCandidates: "apps/web/app/api/facebook-browser/candidates/route.ts",
  adminMagazine: "apps/web/app/api/admin/magazine/generate/route.ts",
  cronMagazine: "apps/web/app/api/cron/magazine-daily/route.ts",
});

function main() {
  const failures = [];

  assertFilesExist(files, failures, ROOT);

  const apiErrorSource = readFileStrict(files.apiError, ROOT);
  assertContains(apiErrorSource, "export function safeErrorMessage", "api-error.ts exports safeErrorMessage", failures);
  assertContains(apiErrorSource, 'NODE_ENV === "development"', "safeErrorMessage gates detail behind dev mode", failures);
  assertContains(apiErrorSource, "export function handleRouteError", "api-error.ts exports handleRouteError", failures);

  // Every previously-leaking route must use safeErrorMessage and must NOT
  // inline the raw `error instanceof Error ? error.message` pattern.
  const routeFiles = [
    ["videos/newest", files.newest],
    ["videos/newest/facets", files.newestFacets],
    ["categories", files.categories],
    ["facebook-browser/candidates", files.facebookCandidates],
    ["admin/magazine/generate", files.adminMagazine],
    ["cron/magazine-daily", files.cronMagazine],
  ];

  for (const [name, filePath] of routeFiles) {
    const source = readFileStrict(filePath, ROOT);
    assertContains(source, "safeErrorMessage", `${name} uses safeErrorMessage`, failures);
    assertNotContains(source, "error instanceof Error ? error.message", `${name} no longer inlines raw error.message`, failures);
  }

  finishInvariantCheck({
    failures,
    failureHeader: "\nError-sanitization invariants FAILED:",
    successMessage: "\nAll error-sanitization invariants passed.",
  });
}

main();
