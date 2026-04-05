import { PrismaClient } from "@prisma/client";

declare global {
  var __yehPrisma__: PrismaClient | undefined;
  var __yehPrismaShutdownHooks__: boolean | undefined;
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

export const prisma =
  global.__yehPrisma__ ??
  new PrismaClient({
    datasources: {
      db: {
        url: getPrismaDatabaseUrl(),
      },
    },
  });

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
