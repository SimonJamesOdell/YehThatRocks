const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

const { loadDatabaseEnv } = require("./lib/runtime");

async function main() {
  loadDatabaseEnv();

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set.");
  }

  const prisma = new PrismaClient();

  const getTableColumns = async (tableName) => {
    const rows = await prisma.$queryRawUnsafe(`SHOW COLUMNS FROM ${tableName}`);
    return new Set(rows.map((row) => String(row.Field)));
  };

  const pickFirstExisting = (columns, candidates, label) => {
    for (const candidate of candidates) {
      if (columns.has(candidate)) {
        return candidate;
      }
    }

    throw new Error(`Missing required column for ${label}. Tried: ${candidates.join(", ")}`);
  };

  const ensureIndex = async (tableName, indexName, createSql) => {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS c FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
      tableName,
      indexName,
    );

    const exists = Number(rows?.[0]?.c ?? 0) > 0;
    if (exists) {
      console.log(`[skip] ${indexName} already exists`);
      return;
    }

    await prisma.$executeRawUnsafe(createSql);
    console.log(`[ok] created ${indexName}`);
  };

  try {
    const videoColumns = await getTableColumns("videos");
    const updatedColumn = pickFirstExisting(videoColumns, ["updated_at", "updatedAt"], "videos updated timestamp");
    const viewsColumn = pickFirstExisting(videoColumns, ["views", "viewCount"], "videos views");

    await ensureIndex(
      "videos",
      "idx_videos_updated_at_id",
      `CREATE INDEX idx_videos_updated_at_id ON videos (${updatedColumn}, id)`,
    );

    await ensureIndex(
      "videos",
      "idx_videos_favourited_views_videoId",
      `CREATE INDEX idx_videos_favourited_views_videoId ON videos (favourited, ${viewsColumn}, videoId)`,
    );

    await ensureIndex(
      "videos",
      "idx_videos_views",
      `CREATE INDEX idx_videos_views ON videos (${viewsColumn})`,
    );

    await ensureIndex(
      "site_videos",
      "idx_site_videos_video_id_status",
      "CREATE INDEX idx_site_videos_video_id_status ON site_videos (video_id, status)",
    );

    await ensureIndex(
      "site_videos",
      "idx_site_videos_status_video_id",
      "CREATE INDEX idx_site_videos_status_video_id ON site_videos (status, video_id)",
    );

    await ensureIndex(
      "related",
      "idx_related_videoId_related",
      "CREATE INDEX idx_related_videoId_related ON related (videoId, related)",
    );

    await ensureIndex(
      "related",
      "idx_related_related_videoId",
      "CREATE INDEX idx_related_related_videoId ON related (related, videoId)",
    );

    await prisma.$executeRawUnsafe("ANALYZE TABLE videos, site_videos, related");
    console.log("[ok] analyzed tables");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
