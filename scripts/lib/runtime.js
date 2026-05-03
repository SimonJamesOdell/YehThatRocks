"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_DATABASE_ENV_PATHS = [
  path.resolve(process.cwd(), ".env.production"),
  path.resolve(process.cwd(), "apps/web/.env.production"),
  path.resolve(process.cwd(), ".env.local"),
  path.resolve(process.cwd(), "apps/web/.env.local"),
];

function parseEnvLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match) {
    return null;
  }

  const [, key, rawValue] = match;
  return {
    key,
    value: rawValue.replace(/^"/, "").replace(/"$/, ""),
  };
}

function loadEnvFile(envPath) {
  if (!envPath || !fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      continue;
    }

    if (process.env[parsed.key]) {
      continue;
    }

    process.env[parsed.key] = parsed.value;
  }
}

function loadDatabaseEnv(options = {}) {
  const candidateEnvPaths = Array.isArray(options.candidateEnvPaths)
    ? options.candidateEnvPaths
    : DEFAULT_DATABASE_ENV_PATHS;

  for (const envPath of candidateEnvPaths) {
    loadEnvFile(envPath);
  }
}

module.exports = {
  DEFAULT_DATABASE_ENV_PATHS,
  loadDatabaseEnv,
};
