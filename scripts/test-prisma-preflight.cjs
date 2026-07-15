/**
 * Pre-flight: verify the Prisma MariaDB adapter can connect to MySQL
 * with the same pool parameters the production server will use.
 *
 * Called by verify-deps-full.ps1 BEFORE starting the Next.js server.
 * Exits 0 on success, 1 on failure.
 */
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");
const { PrismaClient } = require("@prisma/client");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

(async () => {
  // Mirror the pool configuration from apps/web/lib/db.ts getPrismaDatabaseUrl()
  // so we test the EXACT same setup the production server will use.
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    console.error("Invalid DATABASE_URL:", databaseUrl.replace(/:[^:@]+@/, ":****@"));
    process.exit(1);
  }

  if (!url.searchParams.has("connectionLimit")) {
    url.searchParams.set("connectionLimit", "24");
  }
  if (!url.searchParams.has("minimumIdle")) {
    url.searchParams.set("minimumIdle", "5");
  }
  if (!url.searchParams.has("acquireTimeout")) {
    url.searchParams.set("acquireTimeout", "10000");
  }
  if (!url.searchParams.has("connectTimeout")) {
    url.searchParams.set("connectTimeout", "3000");
  }

  try {
    const adapter = new PrismaMariaDb(url.toString());
    const prisma = new PrismaClient({ adapter });
    await prisma.$connect();
    // Run a real query to confirm the pool is healthy
    await prisma.$queryRawUnsafe("SELECT 1");
    await prisma.$disconnect();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
})();
