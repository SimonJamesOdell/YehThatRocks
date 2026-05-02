import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { clearCatalogVideoCaches } from "@/lib/catalog-data";
import { clearCurrentVideoRouteCaches } from "@/lib/current-video-cache";
import { prisma } from "@/lib/db";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

const RECENTLY_APPROVED_WINDOW_MINUTES = 60;

const revokeSchema = z.object({
  videoId: z.string().trim().min(1).max(64),
});

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: number;
      videoId: string;
      title: string;
      parsedArtist: string | null;
      parsedTrack: string | null;
      channelTitle: string | null;
      updatedAt: Date | null;
    }>
  >(
    `
      SELECT id, videoId, title, parsedArtist, parsedTrack, channelTitle, updated_at AS updatedAt
      FROM videos
      WHERE approved = 1
        AND updated_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
      ORDER BY updated_at DESC
      LIMIT 50
    `,
    RECENTLY_APPROVED_WINDOW_MINUTES,
  );

  return NextResponse.json({ recentlyApproved: rows, windowMinutes: RECENTLY_APPROVED_WINDOW_MINUTES });
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

  const parsed = revokeSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { videoId } = parsed.data;

  const revokedRows = await prisma.video.updateMany({
    where: { videoId, approved: true },
    data: { approved: false, updatedAt: new Date() },
  });

  if (revokedRows.count === 0) {
    const existing = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM videos WHERE videoId = ${videoId} LIMIT 1
    `;

    if (existing.length === 0) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }
  }

  clearCatalogVideoCaches();
  clearCurrentVideoRouteCaches();

  return NextResponse.json({ ok: true, videoId, action: "revoke" });
}
