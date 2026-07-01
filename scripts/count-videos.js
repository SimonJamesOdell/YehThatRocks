#!/usr/bin/env node
"use strict";

const { PrismaClient } = require("@prisma/client");
const { loadDatabaseEnv } = require("./lib/runtime");

const COUNTS = {
  "available": `
    SELECT COUNT(*) AS c
    FROM videos v
    WHERE EXISTS (
      SELECT 1
      FROM site_videos sv
      WHERE sv.video_id = v.id
        AND sv.status = 'available'
    )
  `,
  "total": "SELECT COUNT(*) AS c FROM videos",
  "non-music-keyword": `
    SELECT COUNT(*) AS c
    FROM videos v
    WHERE EXISTS (
      SELECT 1 FROM site_videos sv
      WHERE sv.video_id = v.id
        AND sv.status = 'available'
    )
    AND (
      LOWER(v.title) REGEXP 'instagram|tiktok|facebook|whatsapp|snapchat|podcast|interview|prank|challenge|reaction|vlog|tutorial|gameplay|livestream|stream highlights?|news|fails?|compilation|meme|shorts?'
      OR LOWER(COALESCE(v.description, '')) REGEXP 'instagram|tiktok|facebook|whatsapp|snapchat|podcast|interview|prank|challenge|reaction|vlog|tutorial|gameplay|livestream|stream highlights?|news|fails?|compilation|meme|shorts?'
    )
  `,
};

async function main() {
  const mode = process.argv[2];
  if (!mode || !COUNTS[mode]) {
    console.error(`Usage: node scripts/count-videos.js <mode>`);
    console.error(`Modes: ${Object.keys(COUNTS).join(", ")}`);
    process.exit(1);
  }

  loadDatabaseEnv();
  const prisma = new PrismaClient();

  try {
    const rows = await prisma.$queryRawUnsafe(COUNTS[mode]);
    const count = Number(rows[0].c);
    console.log(`${mode}_videos=${count}`);
    if (mode === "non-music-keyword") {
      console.log(`non_music_keyword_available=${count}`);
    }
    if (mode === "available") {
      console.log(`available_video_rows=${count}`);
    }
    if (mode === "total") {
      console.log(`videos_total_rows=${count}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
