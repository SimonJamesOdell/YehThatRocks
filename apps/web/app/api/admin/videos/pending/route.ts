import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { ensurePendingVideoQueueIndex, PENDING_VIDEO_APPROVAL_WHERE_CLAUSE } from "@/lib/admin-pending-video-queue";
import { clearCatalogVideoCaches, pruneVideoAndAssociationsByVideoId } from "@/lib/catalog-data";
import { clearCurrentVideoRouteCaches } from "@/lib/current-video-cache";
import { prisma } from "@/lib/db";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

const moderatePendingSchema = z.object({
  videoId: z.string().trim().min(1).max(64),
  action: z.enum(["approve", "remove"]),
  title: z.string().trim().min(1).max(255).optional(),
  parsedArtist: z.string().trim().max(255).nullable().optional(),
  parsedTrack: z.string().trim().max(255).nullable().optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);

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
        createdAt: Date | null;
        updatedAt: Date | null;
      }>>(
        `
        SELECT id, videoId, title, parsedArtist, parsedTrack, channelTitle, created_at AS createdAt, updated_at AS updatedAt
        FROM videos
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
        createdAt: Date | null;
        updatedAt: Date | null;
      }>>(
        `
        SELECT id, videoId, title, parsedArtist, parsedTrack, channelTitle, created_at AS createdAt, updated_at AS updatedAt
        FROM videos
        WHERE ${PENDING_VIDEO_APPROVAL_WHERE_CLAUSE}
        ORDER BY created_at DESC, id DESC
        LIMIT 100
      `,
      );

  return NextResponse.json({ pendingVideos, totalPending });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const csrf = verifySameOrigin(request);
  if (csrf) {
    return csrf;
  }

  const body = await parseRequestJson(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = moderatePendingSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { videoId, action } = parsed.data;

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

    if (parsed.data.title !== undefined) {
      approveData.title = parsed.data.title;
    }

    if (parsed.data.parsedArtist !== undefined) {
      approveData.parsedArtist = parsed.data.parsedArtist;
    }

    if (parsed.data.parsedTrack !== undefined) {
      approveData.parsedTrack = parsed.data.parsedTrack;
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

  if (pruneResult.reason === "not-found") {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  if (!pruneResult.pruned) {
    return NextResponse.json({ error: "Could not delete video", reason: pruneResult.reason }, { status: 409 });
  }

  clearCurrentVideoRouteCaches();

  return NextResponse.json({ ok: true, videoId, action: "remove", deletedVideoRows: pruneResult.deletedVideoRows });
}
