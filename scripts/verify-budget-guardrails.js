#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const folderLineBudgets = [
  {
    name: "components",
    folder: path.join(ROOT, "apps/web/components"),
    extensions: new Set([".ts", ".tsx"]),
    warningMaxLines: 5600,
    hardMaxLines: 6200,
  },
  {
    name: "lib",
    folder: path.join(ROOT, "apps/web/lib"),
    extensions: new Set([".ts", ".tsx"]),
    warningMaxLines: 8200,
    hardMaxLines: 9500,
  },
  {
    name: "api",
    folder: path.join(ROOT, "apps/web/app/api"),
    extensions: new Set([".ts", ".tsx"]),
    warningMaxLines: 1050,
    hardMaxLines: 1200,
  },
];

const topRouteBundleBudgets = [
  {
    route: "/",
    manifestPath: path.join(ROOT, "apps/web/.next/server/app/(shell)/page_client-reference-manifest.js"),
    entryKeyIncludes: "/app/(shell)/layout",
    warningMaxBytes: 560000,
    hardMaxBytes: 620000,
  },
  {
    route: "/new",
    manifestPath: path.join(ROOT, "apps/web/.next/server/app/(shell)/new/page_client-reference-manifest.js"),
    entryKeyIncludes: "/app/(shell)/new/page",
    warningMaxBytes: 610000,
    hardMaxBytes: 680000,
  },
  {
    route: "/top100",
    manifestPath: path.join(ROOT, "apps/web/.next/server/app/(shell)/top100/page_client-reference-manifest.js"),
    entryKeyIncludes: "/app/(shell)/top100/page",
    warningMaxBytes: 620000,
    hardMaxBytes: 700000,
  },
  {
    route: "/search",
    manifestPath: path.join(ROOT, "apps/web/.next/server/app/(shell)/search/page_client-reference-manifest.js"),
    entryKeyIncludes: "/app/(shell)/search/page",
    warningMaxBytes: 620000,
    hardMaxBytes: 700000,
  },
  {
    route: "/categories",
    manifestPath: path.join(ROOT, "apps/web/.next/server/app/(shell)/categories/page_client-reference-manifest.js"),
    entryKeyIncludes: "/app/(shell)/categories/page",
    warningMaxBytes: 620000,
    hardMaxBytes: 700000,
  },
];

const apiDuplicationPatternBudgets = [
  {
    name: "direct request.json parsing",
    regex: /await\s+request\.json\s*\(/g,
    warningMax: 1,
    hardMax: 2,
  },
  {
    name: "manual 401 status literals",
    regex: /status\s*:\s*401/g,
    warningMax: 6,
    hardMax: 8,
  },
  {
    name: "manual 403 status literals",
    regex: /status\s*:\s*403/g,
    warningMax: 2,
    hardMax: 4,
  },
  {
    name: "requireApiAuth(request) boilerplate",
    regex: /requireApiAuth\(request\)/g,
    warningMax: 36,
    hardMax: 45,
  },
  {
    name: "verifySameOrigin(request) boilerplate",
    regex: /verifySameOrigin\(request\)/g,
    warningMax: 45,
    hardMax: 55,
  },
  {
    name: "parseRequestJson(request) boilerplate",
    regex: /parseRequestJson\(request\)/g,
    warningMax: 36,
    hardMax: 48,
  },
];

function toRelative(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function walkFiles(folder, extensions, out = []) {
  if (!fs.existsSync(folder)) {
    return out;
  }

  const entries = fs.readdirSync(folder, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, extensions, out);
      continue;
    }

    const ext = path.extname(entry.name);
    if (extensions.has(ext)) {
      out.push(fullPath);
    }
  }

  return out;
}

function countLines(source) {
  if (!source) {
    return 0;
  }

  const normalized = source.replace(/\r\n/g, "\n");
  return normalized.split("\n").length;
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function parseClientReferenceManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing manifest: ${toRelative(manifestPath)}`);
  }

  const source = fs.readFileSync(manifestPath, "utf8");
  const match = source.match(/\]\s*=\s*(\{[\s\S]*\})\s*;\s*$/);
  if (!match || !match[1]) {
    throw new Error(`Malformed client-reference payload: ${toRelative(manifestPath)}`);
  }

  const payloadText = match[1];
  return JSON.parse(payloadText);
}

function evaluateFolderLineBudgets(warnings, failures) {
  for (const budget of folderLineBudgets) {
    const files = walkFiles(budget.folder, budget.extensions);
    for (const filePath of files) {
      const source = fs.readFileSync(filePath, "utf8");
      const lines = countLines(source);

      if (lines > budget.hardMaxLines) {
        failures.push(
          `Line budget exceeded in ${toRelative(filePath)} (${lines} > ${budget.hardMaxLines}) for ${budget.name}`,
        );
      } else if (lines > budget.warningMaxLines) {
        warnings.push(
          `Line budget warning in ${toRelative(filePath)} (${lines} > ${budget.warningMaxLines}) for ${budget.name}`,
        );
      }
    }
  }
}

function resolveEntryJsFiles(manifestJson, entryKeyIncludes) {
  const entryJsFiles = manifestJson?.entryJSFiles;
  if (!entryJsFiles || typeof entryJsFiles !== "object") {
    return null;
  }

  const key = Object.keys(entryJsFiles).find((candidate) => candidate.includes(entryKeyIncludes));
  if (!key) {
    return null;
  }

  return {
    key,
    chunks: Array.isArray(entryJsFiles[key]) ? entryJsFiles[key] : [],
  };
}

function evaluateTopRouteBundleBudgets(warnings, failures) {
  const nextRoot = path.join(ROOT, "apps/web/.next");

  for (const budget of topRouteBundleBudgets) {
    let manifest;
    try {
      manifest = parseClientReferenceManifest(budget.manifestPath);
    } catch (error) {
      failures.push(
        `Bundle budget check failed for route ${budget.route}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    const entry = resolveEntryJsFiles(manifest, budget.entryKeyIncludes);
    if (!entry) {
      failures.push(
        `Bundle budget check failed for route ${budget.route}: entryJSFiles key containing '${budget.entryKeyIncludes}' was not found in ${toRelative(budget.manifestPath)}`,
      );
      continue;
    }

    let totalBytes = 0;
    const missingChunks = [];

    for (const chunkPath of entry.chunks) {
      const normalizedChunkPath = chunkPath.replace(/^\/_next\//, "");
      const absoluteChunkPath = path.join(nextRoot, normalizedChunkPath);
      if (!fs.existsSync(absoluteChunkPath)) {
        missingChunks.push(normalizedChunkPath);
        continue;
      }

      const stats = fs.statSync(absoluteChunkPath);
      totalBytes += stats.size;
    }

    if (missingChunks.length > 0) {
      failures.push(
        `Bundle budget check failed for route ${budget.route}: missing chunk files (${missingChunks.slice(0, 4).join(", ")}${missingChunks.length > 4 ? ", ..." : ""})`,
      );
      continue;
    }

    if (totalBytes > budget.hardMaxBytes) {
      failures.push(
        `Bundle budget exceeded for route ${budget.route} (${formatBytes(totalBytes)} > ${formatBytes(budget.hardMaxBytes)})`,
      );
    } else if (totalBytes > budget.warningMaxBytes) {
      warnings.push(
        `Bundle budget warning for route ${budget.route} (${formatBytes(totalBytes)} > ${formatBytes(budget.warningMaxBytes)})`,
      );
    }
  }
}

function countPatternMatchesInFiles(files, regex) {
  const clonedRegex = new RegExp(regex.source, regex.flags);
  let total = 0;
  const matchedFiles = new Set();

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, "utf8");
    clonedRegex.lastIndex = 0;
    const matches = source.match(clonedRegex);
    if (!matches || matches.length === 0) {
      continue;
    }

    total += matches.length;
    matchedFiles.add(filePath);
  }

  return {
    total,
    fileCount: matchedFiles.size,
  };
}

function evaluateApiDuplicationBudgets(warnings, failures) {
  const apiRoot = path.join(ROOT, "apps/web/app/api");
  const apiFiles = walkFiles(apiRoot, new Set([".ts", ".tsx"]))
    .filter((filePath) => filePath.endsWith("route.ts") || filePath.endsWith("route.tsx"));

  for (const budget of apiDuplicationPatternBudgets) {
    const metrics = countPatternMatchesInFiles(apiFiles, budget.regex);
    const descriptor = `${budget.name} (${metrics.total} occurrences across ${metrics.fileCount} files)`;

    if (metrics.total > budget.hardMax) {
      failures.push(`API duplication threshold exceeded: ${descriptor}; hard max ${budget.hardMax}`);
    } else if (metrics.total > budget.warningMax) {
      warnings.push(`API duplication threshold warning: ${descriptor}; warning max ${budget.warningMax}`);
    }
  }
}

function main() {
  const warnings = [];
  const failures = [];

  evaluateFolderLineBudgets(warnings, failures);
  evaluateTopRouteBundleBudgets(warnings, failures);
  evaluateApiDuplicationBudgets(warnings, failures);

  if (warnings.length > 0) {
    console.warn("Budget guardrail warnings:");
    for (const warning of warnings) {
      console.warn(`- ${warning}`);
    }
  }

  if (failures.length > 0) {
    console.error("Budget guardrail check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Budget guardrail check passed.");
}

main();