import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { mapAdminPruneResultToDeleteResponse } from "@/lib/admin-prune-delete-response";
import { ensureCatalogReviewQueueReady } from "@/lib/admin-catalog-review-queue";
import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import { pruneVideoAndAssociationsByVideoId } from "@/lib/catalog-data";
import { clearCurrentVideoRouteCaches } from "@/lib/current-video-cache";
import { prisma } from "@/lib/db";

const moderateCatalogReviewSchema = z.object({
  videoId: z.string().trim().min(1).max(64),
  action: z.enum(["approve", "remove"]),
});

type CatalogReviewVideoRow = {
  id: number;
  videoId: string;
  title: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
  channelTitle: string | null;
  durationSec: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  enqueuedAt: Date;
};

export async function GET(request: NextRequest) {
  const auth = await requireAuthOnly(request);

  if (!auth.ok) {
    return auth.response;
  }

  await ensureCatalogReviewQueueReady();

  const totalRows = await prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(`
    SELECT COUNT(*) AS total
    FROM admin_catalog_review_queue
  `);
  const remaining = Number(totalRows[0]?.total ?? 0);

  const currentVideoRows = await prisma.$queryRawUnsafe<CatalogReviewVideoRow[]>(`
    SELECT
      v.id,
      v.videoId,
      v.title,
      v.parsedArtist,
      v.parsedTrack,
      v.channelTitle,
      wh.durationSec AS durationSec,
      v.created_at AS createdAt,
      v.updated_at AS updatedAt,
      q.enqueued_at AS enqueuedAt
    FROM admin_catalog_review_queue q
    INNER JOIN videos v
      ON v.videoId COLLATE utf8mb4_unicode_ci = q.video_id COLLATE utf8mb4_unicode_ci
    LEFT JOIN (
      SELECT video_id, MAX(last_duration_sec) AS durationSec
      FROM watch_history
      WHERE last_duration_sec > 0
      GROUP BY video_id
    ) wh ON wh.video_id = v.videoId
    ORDER BY q.enqueued_at ASC, q.video_id ASC
    LIMIT 1
  `);

  return NextResponse.json({
    remaining,
    currentVideo: currentVideoRows[0] ?? null,
  });
}

export async function POST(request: NextRequest) {
  const result = await withAuthAndBody(request, moderateCatalogReviewSchema);

  if (!result.ok) {
    return result.response;
  }

  await ensureCatalogReviewQueueReady();

  const { videoId, action } = result.data;

  if (action === "approve") {
    const queueDelete = await prisma.$executeRawUnsafe(
      `DELETE FROM admin_catalog_review_queue WHERE video_id = ?`,
      videoId,
    );

    if (queueDelete === 0) {
      return NextResponse.json({ error: "Video is not in the catalog review queue" }, { status: 404 });
    }

    const remainingRows = await prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(`
      SELECT COUNT(*) AS total
      FROM admin_catalog_review_queue
    `);

    return NextResponse.json({
      ok: true,
      action: "approve",
      videoId,
      remaining: Number(remainingRows[0]?.total ?? 0),
    });
  }

  const pruneResult = await pruneVideoAndAssociationsByVideoId(videoId, "admin-catalog-review-remove");
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
    `DELETE FROM admin_catalog_review_queue WHERE video_id = ?`,
    videoId,
  );

  clearCurrentVideoRouteCaches();

  const remainingRows = await prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(`
    SELECT COUNT(*) AS total
    FROM admin_catalog_review_queue
  `);

  return NextResponse.json({
    ok: true,
    action: "remove",
    videoId,
    deletedVideoRows: pruneResult.deletedVideoRows,
    remaining: Number(remainingRows[0]?.total ?? 0),
  });
}
