import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { mapAdminPruneResultToDeleteResponse } from "@/lib/admin-prune-delete-response";
import { fetchGenreReviewCurrentVideo } from "@/lib/admin-genre-review-current-video";
import { ensureGenreReviewQueueReady } from "@/lib/admin-genre-review-queue";
import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import { pruneVideoAndAssociationsByVideoId } from "@/lib/catalog-data";
import { clearCurrentVideoRouteCaches } from "@/lib/current-video-cache";
import { prisma } from "@/lib/db";

const moderateGenreReviewSchema = z.object({
  videoId: z.string().trim().min(1).max(64),
  action: z.enum(["approve", "remove"]),
  genre: z.string().trim().min(1).max(255).nullable().optional(),
});

async function getGenreReviewRemaining() {
  const rows = await prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
    `SELECT COUNT(*) AS total FROM admin_genre_review_queue`,
  );
  return Number(rows[0]?.total ?? 0);
}

async function getWorkerState() {
  const rows = await prisma.$queryRawUnsafe<Array<{
    status: string;
    total_videos: bigint | number;
    last_video_id: bigint | number;
    processed_count: bigint | number;
    updated_count: bigint | number;
    deleted_count: bigint | number;
    queued_count: bigint | number;
    started_at: Date | null;
    updated_at: Date | null;
    last_message: string | null;
  }>>(
    `SELECT status, total_videos, last_video_id, processed_count, updated_count, deleted_count, queued_count, started_at, updated_at, last_message
     FROM admin_genre_reclassify_state
     WHERE id = 1
     LIMIT 1`,
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    status: row.status,
    totalVideos: Number(row.total_videos ?? 0),
    lastVideoId: Number(row.last_video_id ?? 0),
    processedCount: Number(row.processed_count ?? 0),
    updatedCount: Number(row.updated_count ?? 0),
    deletedCount: Number(row.deleted_count ?? 0),
    queuedCount: Number(row.queued_count ?? 0),
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    lastMessage: row.last_message,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAuthOnly(request);

  if (!auth.ok) {
    return auth.response;
  }

  await ensureGenreReviewQueueReady();

  const [remaining, currentVideo, worker] = await Promise.all([
    getGenreReviewRemaining(),
    fetchGenreReviewCurrentVideo(),
    getWorkerState(),
  ]);

  return NextResponse.json({
    remaining,
    currentVideo,
    worker,
  });
}

export async function POST(request: NextRequest) {
  const result = await withAuthAndBody(request, moderateGenreReviewSchema);

  if (!result.ok) {
    return result.response;
  }

  await ensureGenreReviewQueueReady();

  const { videoId, action, genre } = result.data;

  if (action === "approve") {
    if (genre && genre.trim().length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE videos SET genre = ?, updated_at = UTC_TIMESTAMP(3) WHERE videoId = ?`,
        genre.trim(),
        videoId,
      );
    }

    const queueDelete = await prisma.$executeRawUnsafe(
      `DELETE FROM admin_genre_review_queue WHERE video_id = ?`,
      videoId,
    );

    if (queueDelete === 0) {
      return NextResponse.json({ error: "Video is not in the genre review queue" }, { status: 404 });
    }

    const remaining = await getGenreReviewRemaining();

    return NextResponse.json({
      ok: true,
      action: "approve",
      videoId,
      remaining,
    });
  }

  const pruneResult = await pruneVideoAndAssociationsByVideoId(videoId, "admin-genre-review-remove");
  const pruneResponse = mapAdminPruneResultToDeleteResponse(pruneResult, {
    ok: true,
    action: "remove",
    videoId,
    deletedVideoRows: pruneResult.deletedVideoRows,
  });

  if (!pruneResponse.deleted) {
    return pruneResponse.response;
  }

  await prisma.$executeRawUnsafe(
    `DELETE FROM admin_genre_review_queue WHERE video_id = ?`,
    videoId,
  );

  clearCurrentVideoRouteCaches();

  const remaining = await getGenreReviewRemaining();

  return NextResponse.json({
    ok: true,
    action: "remove",
    videoId,
    deletedVideoRows: pruneResult.deletedVideoRows,
    remaining,
  });
}
