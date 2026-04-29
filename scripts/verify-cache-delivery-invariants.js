#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const files = {
  nginxConfig: path.join(ROOT, "deploy/nginx/yehthatrocks.conf"),
};

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${path.relative(ROOT, filePath)}`);
  }

  return fs.readFileSync(filePath, "utf8");
}

function assertContains(source, needle, description, failures) {
  if (!source.includes(needle)) {
    failures.push(`${description} (missing: ${needle})`);
  }
}

function main() {
  const failures = [];
  const nginxConfig = read(files.nginxConfig);

  // Static asset cache policy invariants.
  assertContains(nginxConfig, "location ^~ /_next/static/", "Nginx defines explicit location for Next static assets", failures);
  assertContains(nginxConfig, "expires 365d;", "Next static assets include long Expires header", failures);
  assertContains(nginxConfig, "add_header Cache-Control \"public, max-age=31536000, immutable\";", "Next static assets send immutable cache policy", failures);

  // Favicon cache policy invariants.
  assertContains(nginxConfig, "location = /favicon.ico", "Nginx defines explicit location for favicon", failures);
  assertContains(nginxConfig, "expires 7d;", "Favicon includes bounded Expires header", failures);
  assertContains(nginxConfig, "add_header Cache-Control \"public, max-age=604800\";", "Favicon sends bounded cache policy", failures);

  // Existing static folders remain cache-friendly.
  assertContains(nginxConfig, "location /images/", "Nginx keeps explicit /images static location", failures);
  assertContains(nginxConfig, "location /favicons/", "Nginx keeps explicit /favicons static location", failures);

  if (failures.length > 0) {
    console.error("Cache delivery invariant check failed:\n");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Cache delivery invariant check passed.");
}

try {
  main();
} catch (error) {
  console.error("Cache delivery invariant check failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
