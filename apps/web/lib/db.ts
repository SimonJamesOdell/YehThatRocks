import { PrismaClient } from "@prisma/client";

import { recordPrismaOperation } from "@/lib/runtime-profiler";

declare global {
  var __yehPrisma__: PrismaClient | undefined;
  var __yehPrismaShutdownHooks__: boolean | undefined;
  var __yehPrismaProfilingHookInstalled__: boolean | undefined;
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getWorkerCount() {
  const raw = Number(process.env.WEB_CONCURRENCY ?? process.env.APP_INSTANCE_COUNT ?? "1");
  if (!Number.isFinite(raw) || raw < 1) {
    return 1;
  }

  return clamp(Math.floor(raw), 1, 64);
}

function getDefaultConnectionLimit() {
  if (process.env.NODE_ENV !== "production") {
    return "10";
  }

  // Target aggregate pool size across all workers, then split per worker.
  const targetTotalRaw = Number(process.env.PRISMA_TARGET_TOTAL_CONNECTIONS ?? "128");
  const targetTotal = Number.isFinite(targetTotalRaw)
    ? clamp(Math.floor(targetTotalRaw), 32, 512)
    : 128;
  const perWorker = Math.floor(targetTotal / getWorkerCount());
  return String(clamp(perWorker, 8, 24));
}

function getPrismaDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return databaseUrl;
  }

  try {
    const url = new URL(databaseUrl);
    const defaultConnectionLimit = getDefaultConnectionLimit();
    const defaultPoolTimeout = process.env.NODE_ENV === "production" ? "30" : "25";

    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set(
        "connection_limit",
        process.env.PRISMA_CONNECTION_LIMIT ?? defaultConnectionLimit,
      );
    }

    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set(
        "pool_timeout",
        process.env.PRISMA_POOL_TIMEOUT ?? defaultPoolTimeout,
      );
    }

    return url.toString();
  } catch {
    return databaseUrl;
  }
}

function createPrismaClient() {
  const url = getPrismaDatabaseUrl();

  if (!url) {
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

  return new PrismaClient({
    datasources: {
      db: { url },
    },
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
    $use?: (middleware: (params: { model?: string; action: string }, next: (params: { model?: string; action: string }) => Promise<unknown>) => Promise<unknown>) => void;
    $on?: (eventType: "query", callback: (event: PrismaQueryEvent) => void) => void;
  };

  if (typeof prismaWithProfilingHooks.$use === "function") {
    prismaWithProfilingHooks.$use(async (params, next) => {
      const startedAt = performance.now();

      try {
        return await next(params);
      } finally {
        const durationMs = performance.now() - startedAt;
        const model = params.model ?? "$raw";
        const operation = `${model}.${params.action}`;
        recordPrismaOperation(operation, durationMs);
      }
    });
  } else if (typeof prismaWithProfilingHooks.$on === "function") {
    prismaWithProfilingHooks.$on("query", (event) => {
      recordPrismaOperation(normalizeQueryOperation(event.query), event.duration);
    });
  }

  global.__yehPrismaProfilingHookInstalled__ = true;

  setImmediate(() => {
    void import("@/lib/perf-sample-persistence")
      .then(({ startPerfSampling }) => {
        startPerfSampling();
      })
      .catch(() => {
        // Best-effort telemetry startup.
      });
  });
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

if (process.env.NODE_ENV !== "production") {
  global.__yehPrisma__ = prisma;
}
