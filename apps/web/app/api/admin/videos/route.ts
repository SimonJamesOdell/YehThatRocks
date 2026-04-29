import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { clearCatalogVideoCaches, pruneVideoAndAssociationsByVideoId } from "@/lib/catalog-data";
import { clearCurrentVideoRouteCaches } from "@/lib/current-video-cache";
import { prisma } from "@/lib/db";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

const updateSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(1).max(255).optional(),
  parsedArtist: z.string().trim().max(255).nullable().optional(),
  parsedTrack: z.string().trim().max(255).nullable().optional(),
  parsedVideoType: z.string().trim().max(50).nullable().optional(),
  parseConfidence: z.number().min(0).max(1).nullable().optional(),
  channelTitle: z.string().trim().max(255).nullable().optional(),
  description: z.string().trim().nullable().optional(),
});

const deleteSchema = z.object({
  videoId: z.string().trim().min(1).max(64),
});

type VideoColumnMap = {
  id: string;
  videoId: string;
  title: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
  parsedVideoType: string | null;
  parseConfidence: string | null;
  parseMethod: string | null;
  parsedAt: string | null;
  channelTitle: string | null;
  description: string | null;
  updatedAt: string | null;
};

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();

  const videos = await prisma.video.findMany({
    where: q
      ? {
          OR: [
            { videoId: { contains: q } },
            { title: { contains: q } },
            { parsedArtist: { contains: q } },
            { parsedTrack: { contains: q } },
          ],
        }
      : undefined,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      id: true,
      videoId: true,
      title: true,
      parsedArtist: true,
      parsedTrack: true,
      parsedVideoType: true,
      parseConfidence: true,
      channelTitle: true,
      description: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ videos });
}

export async function PATCH(request: NextRequest) {
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

  const parsed = updateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data: {
    title?: string;
    parsedArtist?: string | null;
    parsedTrack?: string | null;
    parsedVideoType?: string | null;
    parseConfidence?: number | null;
    channelTitle?: string | null;
    description?: string | null;
    parsedAt?: Date;
    parseMethod?: string;
  } = {};

  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.parsedArtist !== undefined) data.parsedArtist = parsed.data.parsedArtist || null;
  if (parsed.data.parsedTrack !== undefined) data.parsedTrack = parsed.data.parsedTrack || null;
  if (parsed.data.parsedVideoType !== undefined) data.parsedVideoType = parsed.data.parsedVideoType || null;
  if (parsed.data.parseConfidence !== undefined) data.parseConfidence = parsed.data.parseConfidence;
  if (parsed.data.channelTitle !== undefined) data.channelTitle = parsed.data.channelTitle || null;
  if (parsed.data.description !== undefined) data.description = parsed.data.description || null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }
  data.parsedAt = new Date();
  data.parseMethod = "admin-manual";

  const updated = await prisma.video
    .update({
      where: { id: parsed.data.id },
      data,
      select: {
        id: true,
        videoId: true,
        title: true,
        parsedArtist: true,
        parsedTrack: true,
        parsedVideoType: true,
        parseConfidence: true,
        channelTitle: true,
        updatedAt: true,
      },
    })
    .catch(() => null);

  if (!updated) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  clearCatalogVideoCaches();
  clearCurrentVideoRouteCaches();

  return NextResponse.json({ ok: true, video: updated });
}

export async function DELETE(request: NextRequest) {
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

  const parsed = deleteSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const pruneResult = await pruneVideoAndAssociationsByVideoId(parsed.data.videoId, "admin-hard-delete");

  if (pruneResult.reason === "not-found") {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  if (!pruneResult.pruned) {
    return NextResponse.json({ error: "Could not delete video", reason: pruneResult.reason }, { status: 409 });
  }

  clearCurrentVideoRouteCaches();

  return NextResponse.json({ ok: true, deletedVideoRows: pruneResult.deletedVideoRows });
}
