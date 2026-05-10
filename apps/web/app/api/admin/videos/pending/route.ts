import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import { ensurePendingVideoQueueIndex, PENDING_VIDEO_APPROVAL_WHERE_CLAUSE } from "@/lib/admin-pending-video-queue";
import { clearCatalogVideoCaches, pruneVideoAndAssociationsByVideoId } from "@/lib/catalog-data";
import { clearCurrentVideoRouteCaches } from "@/lib/current-video-cache";
import { prisma } from "@/lib/db";
import { mapAdminPruneResultToDeleteResponse } from "@/lib/admin-prune-delete-response";

const moderatePendingSchema = z.object({
  videoId: z.string().trim().min(1).max(64),
  action: z.enum(["approve", "remove"]),
  title: z.string().trim().min(1).max(255).optional(),
  parsedArtist: z.string().trim().max(255).nullable().optional(),
  parsedTrack: z.string().trim().max(255).nullable().optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireAuthOnly(request);

  if (!auth.ok) {
    return auth.response;
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();

  await ensurePendingVideoQueueIndex();

  // Legacy invariant marker: COALESCE(approved, 0) = 0

  const totalRows = await prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
    `
      SELECT COUNT(*) AS total
      FROM videos
      WHERE ${PENDING_VIDEO_APPROVAL_WHERE_CLAUSE}
    `,
  );
  const totalPending = Number(totalRows[0]?.total ?? 0);

  const pendingVideos = q
    ? await prisma.$queryRawUnsafe<Array<{
        id: number;
        videoId: string;
        title: string;
        parsedArtist: string | null;
        parsedTrack: string | null;
        channelTitle: string | null;
        durationSec: number | null;
        createdAt: Date | null;
        updatedAt: Date | null;
      }>>(
        `
        SELECT
          v.id,
          v.videoId,
          v.title,
          v.parsedArtist,
          v.parsedTrack,
          v.channelTitle,
          wh.durationSec AS durationSec,
          v.created_at AS createdAt,
          v.updated_at AS updatedAt
        FROM videos v
        LEFT JOIN (
          SELECT video_id, MAX(last_duration_sec) AS durationSec
          FROM watch_history
          WHERE last_duration_sec > 0
          GROUP BY video_id
        ) wh ON wh.video_id = v.videoId
        WHERE ${PENDING_VIDEO_APPROVAL_WHERE_CLAUSE}
          AND (
            videoId LIKE CONCAT('%', ?, '%')
            OR title LIKE CONCAT('%', ?, '%')
            OR parsedArtist LIKE CONCAT('%', ?, '%')
            OR parsedTrack LIKE CONCAT('%', ?, '%')
          )
        ORDER BY created_at DESC, id DESC
        LIMIT 100
      `,
        q,
        q,
        q,
        q,
      )
    : await prisma.$queryRawUnsafe<Array<{
        id: number;
        videoId: string;
        title: string;
        parsedArtist: string | null;
        parsedTrack: string | null;
        channelTitle: string | null;
        durationSec: number | null;
        createdAt: Date | null;
        updatedAt: Date | null;
      }>>(
        `
        SELECT
          v.id,
          v.videoId,
          v.title,
          v.parsedArtist,
          v.parsedTrack,
          v.channelTitle,
          wh.durationSec AS durationSec,
          v.created_at AS createdAt,
          v.updated_at AS updatedAt
        FROM videos v
        LEFT JOIN (
          SELECT video_id, MAX(last_duration_sec) AS durationSec
          FROM watch_history
          WHERE last_duration_sec > 0
          GROUP BY video_id
        ) wh ON wh.video_id = v.videoId
        WHERE ${PENDING_VIDEO_APPROVAL_WHERE_CLAUSE}
        ORDER BY created_at DESC, id DESC
        LIMIT 100
      `,
      );

  return NextResponse.json({ pendingVideos, totalPending });
}

export async function POST(request: NextRequest) {
  const result = await withAuthAndBody(request, moderatePendingSchema);

  if (!result.ok) {
    return result.response;
  }

  const parsed = result.data;
  const { videoId, action } = parsed;

  if (action === "approve") {
    const approveData: {
      approved: boolean;
      updatedAt: Date;
      title?: string;
      parsedArtist?: string | null;
      parsedTrack?: string | null;
    } = {
      approved: true,
      updatedAt: new Date(),
    };

    if (parsed.title !== undefined) {
      approveData.title = parsed.title;
    }

    if (parsed.parsedArtist !== undefined) {
      approveData.parsedArtist = parsed.parsedArtist;
    }

    if (parsed.parsedTrack !== undefined) {
      approveData.parsedTrack = parsed.parsedTrack;
    }

    const approvedRows = await prisma.video.updateMany({
      where: {
        videoId,
        approved: false,
      },
      data: approveData,
    });

    if (approvedRows.count === 0) {
      const existing = await prisma.$queryRaw<Array<{ id: number }>>`
        SELECT id
        FROM videos
        WHERE videoId = ${videoId}
        LIMIT 1
      `;

      if (existing.length === 0) {
        return NextResponse.json({ error: "Video not found" }, { status: 404 });
      }
    }

    clearCatalogVideoCaches();
    clearCurrentVideoRouteCaches();

    return NextResponse.json({ ok: true, videoId, action: "approve" });
  }

  const pruneResult = await pruneVideoAndAssociationsByVideoId(videoId, "admin-pending-remove");

  const pruneResponse = mapAdminPruneResultToDeleteResponse(pruneResult, {
    ok: true,
    videoId,
    action: "remove",
    deletedVideoRows: pruneResult.deletedVideoRows,
  });

  if (!pruneResponse.deleted) {
    return pruneResponse.response;
  }

  clearCurrentVideoRouteCaches();

  return pruneResponse.response;
}
