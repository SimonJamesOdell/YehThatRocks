/**
 * Pre-flight: verify the Prisma MariaDB adapter can connect to MySQL
 * with pool parameters matching the production/dev server config.
 *
 * Called by verify-deps-full.ps1 BEFORE starting the Next.js server.
 * Exits 0 on success, 1 on failure.
 *
 * Key design choice: minimumIdle=1. The preflight only needs to prove a
 * single connection works. Higher minimumIdle values (like the 2-5 used
 * by the production server) cause mysql2 to open multiple connections
 * concurrently during $connect(). If any connection fails during startup,
 * mysql2 pools permanently exhaust (active=0 idle=0) and never recover.
 * Proving one connection works is sufficient for a preflight check.
 */
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");
const { PrismaClient } = require("@prisma/client");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

function getDefaultConnectionLimit() {
  if (process.env.NODE_ENV !== "production") return "10";
  return "24";
}

(async () => {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    console.error("Invalid DATABASE_URL:", databaseUrl.replace(/:[^:@]+@/, ":****@"));
    process.exit(1);
  }

  // Match the pool config from apps/web/lib/db.ts getPrismaDatabaseUrl(),
  // but with minimumIdle=1 specifically for preflight.
  if (!url.searchParams.has("connectionLimit")) {
    url.searchParams.set(
      "connectionLimit",
      process.env.PRISMA_CONNECTION_LIMIT ?? getDefaultConnectionLimit(),
    );
  }
  if (!url.searchParams.has("minimumIdle")) {
    // Preflight only needs ONE connection. Higher values risk pool exhaustion
    // if multiple concurrent opens fail during MySQL warmup.
    url.searchParams.set("minimumIdle", "1");
  }
  if (!url.searchParams.has("acquireTimeout")) {
    url.searchParams.set(
      "acquireTimeout",
      process.env.PRISMA_POOL_TIMEOUT_MS ??
        (process.env.NODE_ENV === "production" ? "10000" : "30000"),
    );
  }
  if (!url.searchParams.has("connectTimeout")) {
    url.searchParams.set(
      "connectTimeout",
      process.env.PRISMA_CONNECT_TIMEOUT_MS ??
        (process.env.NODE_ENV === "production" ? "3000" : "5000"),
    );
  }

  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let prisma;
    try {
      const adapter = new PrismaMariaDb(url.toString());
      prisma = new PrismaClient({ adapter });
      await prisma.$connect();
      await prisma.$queryRawUnsafe("SELECT 1");
      // Success — clean exit.
      await prisma.$disconnect();
      process.exit(0);
    } catch (e) {
      lastError = e;
      if (prisma) {
        try { await prisma.$disconnect(); } catch {}
      }
      if (attempt < maxAttempts) {
        // mysql2 pools can permanently exhaust. Wait and retry with a fresh pool.
        const delay = Math.pow(2, attempt) * 1000;
        console.error(`  Pre-flight attempt ${attempt} failed: ${e.message}`);
        console.error(`  Retrying in ${delay / 1000}s with a fresh pool...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  console.error(lastError?.message || "Pre-flight failed");
  process.exit(1);
})();
