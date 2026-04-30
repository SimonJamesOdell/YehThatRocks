import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { clearCatalogVideoCaches, pruneVideoAndAssociationsByVideoId } from "@/lib/catalog-data";
import { clearCurrentVideoRouteCaches } from "@/lib/current-video-cache";
import { prisma } from "@/lib/db";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

const moderatePendingSchema = z.object({
  videoId: z.string().trim().min(1).max(64),
  action: z.enum(["approve", "remove"]),
});

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();

  const pendingVideos = q
    ? await prisma.$queryRaw<Array<{
        id: number;
        videoId: string;
        title: string;
        parsedArtist: string | null;
        parsedTrack: string | null;
        channelTitle: string | null;
        createdAt: Date | null;
        updatedAt: Date | null;
      }>>`
        SELECT id, videoId, title, parsedArtist, parsedTrack, channelTitle, created_at AS createdAt, updated_at AS updatedAt
        FROM videos
        WHERE COALESCE(approved, 0) = 0
          AND (
            videoId LIKE CONCAT('%', ${q}, '%')
            OR title LIKE CONCAT('%', ${q}, '%')
            OR parsedArtist LIKE CONCAT('%', ${q}, '%')
            OR parsedTrack LIKE CONCAT('%', ${q}, '%')
          )
        ORDER BY created_at DESC, id DESC
        LIMIT 100
      `
    : await prisma.$queryRaw<Array<{
        id: number;
        videoId: string;
        title: string;
        parsedArtist: string | null;
        parsedTrack: string | null;
        channelTitle: string | null;
        createdAt: Date | null;
        updatedAt: Date | null;
      }>>`
        SELECT id, videoId, title, parsedArtist, parsedTrack, channelTitle, created_at AS createdAt, updated_at AS updatedAt
        FROM videos
        WHERE COALESCE(approved, 0) = 0
        ORDER BY created_at DESC, id DESC
        LIMIT 100
      `;

  return NextResponse.json({ pendingVideos });
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
    const approvedRows = await prisma.$executeRaw`
      UPDATE videos
      SET approved = 1,
          updated_at = ${new Date()}
      WHERE videoId = ${videoId}
        AND COALESCE(approved, 0) = 0
    `;

    if (Number(approvedRows) === 0) {
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
