#!/usr/bin/env node
"use strict";

const { PrismaClient } = require("@prisma/client");
const { hasFlag } = require("./lib/cli");
const { partitionGenresByScope } = require("./lib/genre-scope");
const { loadDatabaseEnv } = require("./lib/runtime");

loadDatabaseEnv();

if (hasFlag("help")) {
  console.log(
    [
      "Usage: node scripts/prune-non-rock-metal-genres.js [options]",
      "",
      "Options:",
      "  --dry-run                          Show what would be removed",
      "  --confirm=PRUNE_NON_ROCK_METAL     Apply destructive deletes",
      "  --help                             Show this message",
    ].join("\n"),
  );
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to apps/web/.env.local or the current shell.");
  process.exit(1);
}

const isDryRun = hasFlag("dry-run");
const confirmArg = process.argv.find((arg) => arg.startsWith("--confirm="));
const confirmValue = confirmArg ? confirmArg.slice("--confirm=".length) : "";

const prisma = new PrismaClient({ log: ["warn", "error"] });

async function main() {
  const [genreRows, cardRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT name
      FROM genres
      WHERE name IS NOT NULL AND TRIM(name) <> ''
      ORDER BY name ASC
    `,
    prisma.$queryRaw`
      SELECT genre
      FROM genre_cards
      WHERE genre IS NOT NULL AND TRIM(genre) <> ''
      ORDER BY genre ASC
    `,
  ]);

  const { allowed: allowedGenres, disallowed: disallowedGenres } = partitionGenresByScope(genreRows.map((r) => r.name));
  const { disallowed: disallowedCards } = partitionGenresByScope(cardRows.map((r) => r.genre));

  console.log("Rock/metal category scope audit\n");
  console.log(`genres (canonical): total=${genreRows.length} allowed=${allowedGenres.length} remove=${disallowedGenres.length}`);
  console.log(`genre_cards: total=${cardRows.length} remove=${disallowedCards.length}`);

  if (disallowedGenres.length > 0) {
    console.log(`\nCanonical genres to remove (sample): ${disallowedGenres.slice(0, 20).join(", ")}`);
  }
  if (disallowedCards.length > 0) {
    console.log(`\nGenre card rows to remove (sample): ${disallowedCards.slice(0, 20).join(", ")}`);
  }

  if (isDryRun) {
    console.log("\n[dry-run] No rows deleted.");
    return;
  }

  if (confirmValue !== "PRUNE_NON_ROCK_METAL") {
    throw new Error("Refusing to delete rows without --confirm=PRUNE_NON_ROCK_METAL");
  }

  await prisma.$transaction(async (tx) => {
    for (const genre of disallowedCards) {
      await tx.$executeRaw`DELETE FROM genre_cards WHERE genre = ${genre}`;
    }
    for (const genre of disallowedGenres) {
      await tx.$executeRaw`DELETE FROM genres WHERE name = ${genre}`;
    }
  });

  console.log("\nDeleted non-rock/metal category rows from genres and genre_cards.");
}

main()
  .catch((error) => {
    console.error("Fatal error:", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
