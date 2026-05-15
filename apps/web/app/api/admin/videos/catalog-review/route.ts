import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { mapAdminPruneResultToDeleteResponse } from "@/lib/admin-prune-delete-response";
import { applyCatalogReviewQueueCountDelta, getCatalogReviewQueueCount } from "@/lib/admin-catalog-review-count";
import { fetchCatalogReviewCurrentVideo } from "@/lib/admin-catalog-review-current-video";
import { ensureCatalogReviewQueueReady } from "@/lib/admin-catalog-review-queue";
import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import { pruneVideoAndAssociationsByVideoId } from "@/lib/catalog-data";
import { clearCurrentVideoRouteCaches } from "@/lib/current-video-cache";
import { prisma } from "@/lib/db";

const moderateCatalogReviewSchema = z.object({
  videoId: z.string().trim().min(1).max(64),
  action: z.enum(["approve", "remove"]),
});

export async function GET(request: NextRequest) {
  const auth = await requireAuthOnly(request);

  if (!auth.ok) {
    return auth.response;
  }

  await ensureCatalogReviewQueueReady();

  const remaining = await getCatalogReviewQueueCount();
  const currentVideo = await fetchCatalogReviewCurrentVideo();

  return NextResponse.json({
    remaining,
    currentVideo,
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

    const remaining = await applyCatalogReviewQueueCountDelta(queueDelete > 0 ? -1 : 0);

    return NextResponse.json({
      ok: true,
      action: "approve",
      videoId,
      remaining,
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

  const queueDelete = await prisma.$executeRawUnsafe(
    `DELETE FROM admin_catalog_review_queue WHERE video_id = ?`,
    videoId,
  );

  clearCurrentVideoRouteCaches();

  const remaining = await applyCatalogReviewQueueCountDelta(queueDelete > 0 ? -1 : 0);

  return NextResponse.json({
    ok: true,
    action: "remove",
    videoId,
    deletedVideoRows: pruneResult.deletedVideoRows,
    remaining,
  });
}
