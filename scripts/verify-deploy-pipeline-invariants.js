#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { assertInvariant } = require("./smoke-assertions");

const ROOT = path.resolve(__dirname, "..");
const failures = [];

function fileExists(relPath, label) {
  const abs = path.join(ROOT, relPath);
  assertInvariant(fs.existsSync(abs), label, `missing: ${relPath}`, failures);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
}

// ── Entry-point scripts ──────────────────────────────────────────────────
const shipCmd = fileExists("ship.cmd", "ship.cmd entry-point exists");
fileExists("fast.cmd", "fast.cmd entry-point exists");
const pkgJsonRaw = fileExists("package.json", "package.json exists");
const pkg = JSON.parse(pkgJsonRaw);

// ── ship-local.ps1 and its internal gates ────────────────────────────────
const shipLocal = fileExists("deploy/ship-local.ps1", "deploy/ship-local.ps1 exists");

assertInvariant(
  shipLocal.includes("verify:compile"),
  "ship-local.ps1 gate includes verify:compile",
  "gate may be missing the build step",
  failures
);
assertInvariant(
  shipLocal.includes("verify:ui-regressions"),
  "ship-local.ps1 gate includes verify:ui-regressions",
  "gate may be missing static invariant checks",
  failures
);
assertInvariant(
  shipLocal.includes("test:api"),
  "ship-local.ps1 gate includes test:api",
  "gate may be missing API smoke tests",
  failures
);
assertInvariant(
  shipLocal.includes("SkipVerifyGate"),
  "ship-local.ps1 supports -SkipVerifyGate",
  "fast mode escape hatch may be missing",
  failures
);
assertInvariant(
  shipLocal.includes("testServerPid"),
  "ship-local.ps1 manages test server lifecycle",
  "test server start/stop wiring may be broken",
  failures
);

// ── NPM scripts referenced by the gate ───────────────────────────────────
const requiredScripts = [
  "verify:compile",
  "verify:ui-regressions",
  "test:api",
];
for (const name of requiredScripts) {
  assertInvariant(
    typeof pkg.scripts?.[name] === "string",
    `npm script "${name}" exists in package.json`,
    `missing npm script: ${name}`,
    failures
  );
}

// ── test-api.ps1 ─────────────────────────────────────────────────────────
const testApi = fileExists("scripts/test-api.ps1", "scripts/test-api.ps1 exists");
assertInvariant(
  testApi.includes("serverAlreadyRunning"),
  "test-api.ps1 detects pre-existing server",
  "test-api.ps1 may not support warm-server reuse",
  failures
);
assertInvariant(
  testApi.includes("timeout-ms=15000"),
  "test-api.ps1 passes 15s timeout to API smoke scripts",
  "API test timeouts may be too low",
  failures
);

// ── API smoke test scripts ───────────────────────────────────────────────
const apiSmokeScripts = [
  "scripts/verify-core-experience-api-smoke.js",
  "scripts/verify-new-videos-api-smoke.js",
  "scripts/verify-playlists-api-smoke.js",
  "scripts/verify-auth-api-smoke.js",
  "scripts/verify-categories-invariants.js",
];
for (const relPath of apiSmokeScripts) {
  fileExists(relPath, `API smoke script ${path.basename(relPath)} exists`);
}

// ── verify:ui-regressions sub-scripts ────────────────────────────────────
const uiRegressions = pkg.scripts?.["verify:ui-regressions"];
assertInvariant(
  typeof uiRegressions === "string",
  "npm script verify:ui-regressions exists",
  "missing from package.json",
  failures
);

if (uiRegressions) {
  // Extract and validate each sub-script reference
  const subScripts = uiRegressions
    .split("&&")
    .map((s) => s.trim().replace(/^npm run /, ""));

  assertInvariant(
    subScripts.length >= 20,
    "verify:ui-regressions has expected number of sub-checks",
    `found ${subScripts.length} sub-checks`,
    failures
  );

  // Every sub-script must exist in package.json
  for (const name of subScripts) {
    assertInvariant(
      typeof pkg.scripts?.[name] === "string",
      `verify:ui-regressions sub-script "${name}" exists in package.json`,
      `missing npm script referenced by verify:ui-regressions: ${name}`,
      failures
    );
  }
}

// ── Ship-sidecar invariants ──────────────────────────────────────────────
const shipSidecarScripts = [
  "deploy/validate-migrations.sh",
  "Dockerfile",
  "docker/entrypoint.sh",
  "deploy/deploy-prod-hot-swap.sh",
  "scripts/maintain-dependencies.ps1",
];
for (const relPath of shipSidecarScripts) {
  fileExists(relPath, `ship sidecar ${path.basename(relPath)} exists`);
}

if (failures.length === 0) {
  console.log("\nDeploy pipeline invariant check passed.");
  process.exit(0);
}

console.error(`\nDeploy pipeline invariant check failed: ${failures.length} issue(s).`);
failures.forEach((f) => console.error(`  [fail] ${f.description}: ${f.details}`));
process.exit(1);
