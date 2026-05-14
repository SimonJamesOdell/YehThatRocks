#!/usr/bin/env node
/**
 * Web dev bootstrap:
 * - If DATABASE_URL is missing, try sane local Docker defaults.
 * - If DB is reachable, inject DATABASE_URL for this process and initialize admin cache.
 * - Start Next dev with the resolved environment.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const WEB_CWD = path.join(REPO_ROOT, "apps", "web");
const MAINTAIN_SCRIPT = path.join(REPO_ROOT, "scripts", "maintain-admin-dashboard-cache.js");

function toSafeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

async function canConnect(url) {
  let connection;
  try {
    connection = await mysql.createConnection(url);
    await connection.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    if (connection) {
      await connection.end().catch(() => undefined);
    }
  }
}

async function resolveDatabaseUrl() {
  const explicit = process.env.DATABASE_URL;
  if (explicit) {
    const ok = await canConnect(explicit);
    if (!ok) {
      console.error(`❌ DATABASE_URL is set but unreachable: ${toSafeUrl(explicit)}`);
      process.exit(1);
    }
    return explicit;
  }

  const candidates = [
    "mysql://yeh:yehthatrocks@127.0.0.1:3307/yeh",
    "mysql://root:yehthatrocks@127.0.0.1:3307/yeh",
  ];

  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await canConnect(candidate);
    if (ok) {
      console.log(`✓ Auto-detected local DB: ${toSafeUrl(candidate)}`);
      return candidate;
    }
  }

  console.log("✓ DATABASE_URL not set and local DB not reachable - seed data mode");
  return null;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });

    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

async function initializeAdminCacheIfPossible(env) {
  if (!env.DATABASE_URL) {
    return;
  }

  console.log("🔄 Initializing admin dashboard cache...");
  const code = await runCommand("node", [MAINTAIN_SCRIPT], {
    cwd: REPO_ROOT,
    env,
  });

  if (code === 0) {
    console.log("✓ Admin dashboard cache initialized");
  } else {
    console.warn("⚠ Admin dashboard cache initialization failed; continuing dev startup");
  }
}

async function main() {
  const resolvedDatabaseUrl = await resolveDatabaseUrl();
  const env = {
    ...process.env,
    ...(resolvedDatabaseUrl ? { DATABASE_URL: resolvedDatabaseUrl } : {}),
  };

  await initializeAdminCacheIfPossible(env);

  const nextCode = await runCommand("next", ["dev", "--hostname", "0.0.0.0", "--port", "3000"], {
    cwd: WEB_CWD,
    env,
  });

  process.exit(nextCode);
}

void main();
