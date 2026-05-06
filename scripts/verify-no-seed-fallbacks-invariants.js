#!/usr/bin/env node

// Domain: Canonical data access guardrails
// Goal: prevent seed/preview/demo fallback branches from being reintroduced.

const fs = require("node:fs");
const path = require("node:path");
const {
  finishInvariantCheck,
} = require("./invariants/helpers");

const ROOT = process.cwd();
const APP_ROOT = path.join(ROOT, "apps", "web");

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const EXCLUDED_DIR_NAMES = new Set([
  ".next",
  "node_modules",
  ".turbo",
  "coverage",
  "dist",
  "build",
]);

const FORBIDDEN_PATTERNS = [
  { pattern: /\bseedVideos\b/g, label: "seedVideos symbol" },
  { pattern: /\bseedArtists\b/g, label: "seedArtists symbol" },
  { pattern: /\bseedGenres\b/g, label: "seedGenres symbol" },
  { pattern: /\bgetSeedVideoById\b/g, label: "getSeedVideoById symbol" },
  { pattern: /\bgetSeedArtistBySlug\b/g, label: "getSeedArtistBySlug symbol" },
  { pattern: /\bsearchSeedCatalog\b/g, label: "searchSeedCatalog symbol" },
  { pattern: /mode\s*:\s*["']seed["']/g, label: "data-source seed mode" },
  { pattern: /seeded\s+preview\s+data/gi, label: "seeded preview copy" },
  { pattern: /\bdemo\s+catalog\b/gi, label: "demo catalog copy" },
  { pattern: /\bpreview\s+store\b/gi, label: "preview store copy" },
];

function collectSourceFiles(dirPath, acc = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) {
        continue;
      }

      collectSourceFiles(fullPath, acc);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      acc.push(fullPath);
    }
  }

  return acc;
}

function scanFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const findings = [];

  for (const { pattern, label } of FORBIDDEN_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(source)) {
      findings.push(label);
    }
  }

  return findings;
}

function main() {
  const failures = [];
  const files = collectSourceFiles(APP_ROOT);

  for (const filePath of files) {
    const findings = scanFile(filePath);
    if (findings.length === 0) {
      continue;
    }

    failures.push(`${path.relative(ROOT, filePath)} contains forbidden fallback pattern(s): ${findings.join(", ")}`);
  }

  finishInvariantCheck({
    failures,
    failureHeader: "No-seed-fallback invariant check failed.",
    successMessage: "No-seed-fallback invariant check passed.",
  });
}

main();