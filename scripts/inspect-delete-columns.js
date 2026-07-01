const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

const { loadDatabaseEnv } = require("./lib/runtime");

async function main() {
  loadDatabaseEnv();
  const prisma = new PrismaClient();
  const tables = ["videos", "site_videos", "videosbyartist", "playlistitems", "favourites", "messages", "related"];

  try {
    for (const table of tables) {
      const rows = await prisma.$queryRawUnsafe(`SHOW COLUMNS FROM ${table}`);
      console.log(`${table}: ${rows.map((r) => r.Field).join(",")}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
