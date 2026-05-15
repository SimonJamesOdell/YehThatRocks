import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyCatalogReviewQueueCountDelta } from "@/lib/admin-catalog-review-count";
import { ensureCatalogReviewQueueReady } from "@/lib/admin-catalog-review-queue";
import { withAuthAndBody } from "@/lib/api-route-pipeline";
import { prisma } from "@/lib/db";

const catalogReviewUndoSchema = z.object({
  videoId: z.string().trim().min(1).max(64),
  reversedAction: z.enum(["approve", "remove"]),
});

export async function POST(request: NextRequest) {
  const result = await withAuthAndBody(request, catalogReviewUndoSchema);

  if (!result.ok) {
    return result.response;
  }

  await ensureCatalogReviewQueueReady();

  const { videoId, reversedAction } = result.data;

  if (reversedAction === "approve") {
    // Undo an "approve" action: re-add the video to the catalog review queue
    const videoExists = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `SELECT id FROM videos WHERE videoId = ? LIMIT 1`,
      videoId,
    );

    if (!videoExists || videoExists.length === 0) {
      return NextResponse.json(
        { error: "Video not found" },
        { status: 404 },
      );
    }

    // Check if already in queue
    const alreadyQueued = await prisma.$queryRawUnsafe<Array<{ video_id: string }>>(
      `SELECT video_id FROM admin_catalog_review_queue WHERE video_id = ? LIMIT 1`,
      videoId,
    );

    if (alreadyQueued && alreadyQueued.length > 0) {
      return NextResponse.json(
        { error: "Video is already in the catalog review queue" },
        { status: 409 },
      );
    }

    // Re-enqueue the video
    await prisma.$executeRawUnsafe(
      `INSERT INTO admin_catalog_review_queue (video_id, enqueued_at) VALUES (?, NOW())`,
      videoId,
    );
    const remaining = await applyCatalogReviewQueueCountDelta(1);

    return NextResponse.json({
      ok: true,
      action: "undo-approve",
      videoId,
      remaining,
    });
  }

  // reversedAction === "remove"
  // Cannot undo a "remove" because the video was hard-deleted
  return NextResponse.json(
    { error: "Cannot undo a remove action — the video was permanently deleted" },
    { status: 400 },
  );
}
