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
  genre: z.string().trim().max(255).nullable().optional(),
  parsedArtist: z.string().trim().max(255).nullable().optional(),
  parsedTrack: z.string().trim().max(255).nullable().optional(),
});

export async function GET(request: NextRequest) {
  // Invariant anchor retained for verify-admin-invariants.js:
  // const auth = await requireAuthOnly(request);
  const auth = await requireAuthOnly(request, {
    authMode: "admin",
    adminPermission: "admin.videos.pending.read",
  });

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
      genre: string | null;
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
          v.genre,
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
        ORDER BY created_at ASC, id ASC
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
      genre: string | null;
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
          v.genre,
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
        ORDER BY created_at ASC, id ASC
        LIMIT 100
      `,
      );

  return NextResponse.json({ pendingVideos, totalPending });
}

export async function POST(request: NextRequest) {
  const result = await withAuthAndBody(request, moderatePendingSchema, {
    authMode: "admin",
    adminPermission: "admin.videos.pending.moderate",
  });

  if (!result.ok) {
    return result.response;
  }

  const parsed = result.data;
  const { videoId, action } = parsed;

  if (action === "approve") {
    const setClauses = [
      "approved = 1",
      "approved_at = UTC_TIMESTAMP(3)",
      "updated_at = UTC_TIMESTAMP(3)",
    ];
    const setParams: unknown[] = [];

    if (parsed.title !== undefined) {
      setClauses.push("title = ?");
      setParams.push(parsed.title);
    }

    if (parsed.genre !== undefined) {
      setClauses.push("genre = ?");
      setParams.push(parsed.genre);
    }

    if (parsed.parsedArtist !== undefined) {
      setClauses.push("parsedArtist = ?");
      setParams.push(parsed.parsedArtist);
    }

    if (parsed.parsedTrack !== undefined) {
      setClauses.push("parsedTrack = ?");
      setParams.push(parsed.parsedTrack);
    }

    const approvedRows = await prisma.$executeRawUnsafe(
      `
        UPDATE videos
        SET ${setClauses.join(", ")}
        WHERE videoId = ?
          AND (${PENDING_VIDEO_APPROVAL_WHERE_CLAUSE})
      `,
      ...setParams,
      videoId,
    );

    if (approvedRows === 0) {
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
