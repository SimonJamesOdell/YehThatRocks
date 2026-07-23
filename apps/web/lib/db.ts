import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { normalizePrismaQueryFingerprint } from "@/lib/query-fingerprint";
import { recordPrismaOperation, recordPrismaQueryFingerprint } from "@/lib/runtime-profiler";
import { startServerMemoryPressureGuard } from "@/lib/memory-pressure-guard";

declare global {
  var __yehPrisma__: PrismaClient | undefined;
  var __yehPrismaShutdownHooks__: boolean | undefined;
  var __yehPrismaProfilingHookInstalled__: boolean | undefined;
  var __yehMemoryPressureGuardStarted__: boolean | undefined;
  var __yehBootStateRestored__: boolean | undefined;
}

type PrismaQueryEvent = {
  query: string;
  duration: number;
};

function normalizeQueryOperation(query: string) {
  const normalized = query.trim().toUpperCase();
  if (!normalized) {
    return "SQL.UNKNOWN";
  }

  if (normalized.startsWith("SELECT")) {
    return "SQL.SELECT";
  }

  if (normalized.startsWith("INSERT")) {
    return "SQL.INSERT";
  }

  if (normalized.startsWith("UPDATE")) {
    return "SQL.UPDATE";
  }

  if (normalized.startsWith("DELETE")) {
    return "SQL.DELETE";
  }

  return "SQL.OTHER";
}

/**
 * Parse DATABASE_URL into a mariadb-compatible pool config object.
 * mariadb.createPool() with a URI string is broken (active=0 idle=0),
 * but with an object config it works reliably. Prisma 7 requires
 * a driver adapter (engineType="library"), so we parse here.
 */
function parseDbUrl(url: string) {
  const u = new URL(url);
  // Protocol: "mysql:" -> let PrismaMariaDb rewrite to "mariadb:"
  // We pass an object, so mariadb.createPool gets an object.
  return {
    host: u.hostname,
    port: parseInt(u.port, 10) || 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    connectionLimit: 10,
    connectTimeout: 5000,
    // mariadb 3.x enables TLS by default. ssl: false is not recognized —
    // it silently tries TLS and hangs. The connector requires an object
    // with rejectUnauthorized: false to accept the self-signed cert
    // that MySQL 8.0 generates on first boot.
    ssl: { rejectUnauthorized: false },
  };
}

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    // Return a lazy proxy that defers PrismaClient creation until first use.
    // This lets the app boot and serve the "Backend unavailable" UI without
    // DATABASE_URL being set.
    return new Proxy({} as PrismaClient, {
      get(_target, prop) {
        if (prop === "$disconnect" || prop === "then") {
          return () => Promise.resolve();
        }
        throw new Error(
          `DATABASE_URL is not configured. Cannot access prisma.${String(prop)}.`,
        );
      },
    });
  }

  const adapter = new PrismaMariaDb(parseDbUrl(databaseUrl));

  return new PrismaClient({
    adapter,
    log: [
      {
        emit: "event",
        level: "query",
      },
    ],
  });
}

export const prisma = global.__yehPrisma__ ?? createPrismaClient();

if (process.env.DATABASE_URL && !global.__yehPrismaProfilingHookInstalled__) {
  const prismaWithProfilingHooks = prisma as PrismaClient & {
    $on?: (eventType: "query", callback: (event: PrismaQueryEvent) => void) => void;
  };

  if (typeof prismaWithProfilingHooks.$on === "function") {
    prismaWithProfilingHooks.$on("query", (event) => {
      recordPrismaOperation(normalizeQueryOperation(event.query), event.duration);

      recordPrismaQueryFingerprint(normalizePrismaQueryFingerprint(event.query), event.duration);
    });
  }

  global.__yehPrismaProfilingHookInstalled__ = true;
}

if (!global.__yehPrismaShutdownHooks__) {
  const shutdown = async () => {
    try {
      await prisma.$disconnect();
    } catch {
      // Best-effort cleanup during process termination.
    }
  };

  process.once("beforeExit", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  global.__yehPrismaShutdownHooks__ = true;
}

const memoryPressureGuardDisabled = /^(1|true|yes)$/i.test(
  process.env.MEMORY_PRESSURE_GUARD_DISABLED ?? "",
);
const localHostNames = new Set(["127.0.0.1", "localhost", "::1"]);
const runtimeHostName = (process.env.HOSTNAME ?? "").trim().toLowerCase();
const appUrlHostName = (() => {
  try {
    const appUrl = process.env.APP_URL?.trim();
    if (!appUrl) {
      return "";
    }

    return new URL(appUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
})();
const isLocalRuntime = localHostNames.has(runtimeHostName) || localHostNames.has(appUrlHostName);

if (
  process.env.NODE_ENV === "production" &&
  !memoryPressureGuardDisabled &&
  !isLocalRuntime &&
  !global.__yehMemoryPressureGuardStarted__
) {
  startServerMemoryPressureGuard();
  global.__yehMemoryPressureGuardStarted__ = true;
}

// Restore accumulated Prisma telemetry totals from the last shutdown so
// totalsSinceBoot survives Node.js restarts. Also registers SIGTERM/SIGINT
// handlers that persist the current totals before exit.
if (
  process.env.NODE_ENV === "production" &&
  !global.__yehBootStateRestored__
) {
  void import("@/lib/runtime-profiler").then((m) => m.restoreRuntimeProfilingBootState());
  global.__yehBootStateRestored__ = true;
}

if (process.env.NODE_ENV !== "production") {
  global.__yehPrisma__ = prisma;
}