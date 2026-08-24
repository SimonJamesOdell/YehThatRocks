#!/usr/bin/env node

// Domain: UTM / attribution capture.
//
// The audit found UTM params were emitted (RSS outbound links) but never
// captured, so marketing channels could not be attributed. This invariant
// guards the capture foundation: the pure parser module, the client capture
// component, its render in the root layout, and the unit test suite.

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
  utm: "apps/web/lib/utm.ts",
  utmComponent: "apps/web/components/utm-capture.tsx",
  utmTest: "apps/web/lib/utm.test.ts",
  rootLayout: "apps/web/app/layout.tsx",
});

function main() {
  const failures = [];

  assertFilesExist(files, failures, ROOT);

  const utm = readFileStrict(files.utm, ROOT);
  assertContains(utm, "UTM_STORAGE_KEY", "utm.ts defines UTM_STORAGE_KEY", failures);
  assertContains(utm, "export function parseUtmParams", "utm.ts exports parseUtmParams", failures);
  assertContains(utm, "export function hasUtmParams", "utm.ts exports hasUtmParams", failures);
  assertContains(utm, '"utm_source"', "utm.ts tracks utm_source", failures);
  assertContains(utm, '"utm_campaign"', "utm.ts tracks utm_campaign", failures);

  const component = readFileStrict(files.utmComponent, ROOT);
  assertContains(component, '"use client"', "utm-capture is a client component", failures);
  assertContains(component, "parseUtmParams", "utm-capture calls parseUtmParams", failures);
  assertContains(component, "localStorage", "utm-capture persists to localStorage", failures);

  const layout = readFileStrict(files.rootLayout, ROOT);
  assertContains(layout, "UtmCapture", "root layout renders UtmCapture", failures);

  const test = readFileStrict(files.utmTest, ROOT);
  assertContains(test, "parseUtmParams", "utm.test.ts covers parseUtmParams", failures);
  assertContains(test, "hasUtmParams", "utm.test.ts covers hasUtmParams", failures);

  finishInvariantCheck({
    failures,
    failureHeader: "\nUTM capture invariants FAILED:",
    successMessage: "\nAll UTM capture invariants passed.",
  });
}

main();
