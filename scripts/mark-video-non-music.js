const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

const { loadDatabaseEnv } = require("./lib/runtime");

async function main() {
  const videoId = (process.argv[2] || "").trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new Error("Usage: node scripts/mark-video-non-music.js <11-char-video-id>");
  }

  loadDatabaseEnv();
  const prisma = new PrismaClient();

  try {
    const videos = await prisma.$queryRawUnsafe(
      "SELECT id FROM videos WHERE videoId = ? ORDER BY updatedAt DESC, id DESC",
      videoId,
    );

    if (!videos.length) {
      console.log("No matching video found.");
      return;
    }

    for (const row of videos) {
      await prisma.$executeRaw`
        UPDATE videos
        SET
          parsedArtist = ${null},
          parsedTrack = ${null},
          parsedVideoType = ${"unknown"},
          parseMethod = ${"manual-review"},
          parseReason = ${"Manual non-music override"},
          parseConfidence = ${0},
          parsedAt = ${new Date()}
        WHERE id = ${row.id}
      `;

      await prisma.$executeRaw`
        UPDATE site_videos
        SET status = ${"unavailable"}
        WHERE video_id = ${row.id}
      `;
    }

    console.log(`Updated ${videos.length} video row(s) and related site_videos status.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
