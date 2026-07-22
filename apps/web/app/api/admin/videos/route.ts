import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import { clearCatalogVideoCaches, pruneVideoAndAssociationsByVideoId } from "@/lib/catalog-data";
import { clearCurrentVideoRouteCaches } from "@/lib/current-video-cache";
import { prisma } from "@/lib/db";
import { triggerArtistDiscoveryIfNew } from "@/lib/artist-discovery";
import { mapAdminPruneResultToDeleteResponse } from "@/lib/admin-prune-delete-response";

const updateSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(1).max(255).optional(),
  approved: z.boolean().optional(),
  genre: z.string().trim().max(255).nullable().optional(),
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

type AdminVideoListRow = {
  id: number;
  videoId: string;
  title: string | null;
  approved: boolean | null;
  parsedArtist: string | null;
  parsedTrack: string | null;
  parsedVideoType: string | null;
  parseConfidence: number | null;
  channelTitle: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

async function loadVideoGenresByIds(ids: number[]) {
  if (ids.length === 0) {
    return new Map<number, string | null>();
  }

  const placeholders = ids.map(() => "?").join(",");

  const rows = await prisma.$queryRawUnsafe<Array<{ id: number; genre: string | null }>>(
    `SELECT id, genre FROM videos WHERE id IN (${placeholders})`,
    ...ids,
  ).catch(() => []);

  return new Map(rows.map((row: { id: number; genre: string | null }) => [Number(row.id), row.genre ?? null]));
}

async function attachGenresToVideos<T extends { id: number }>(videos: T[]) {
  const genresById = await loadVideoGenresByIds(videos.map((video) => Number(video.id)));
  return videos.map((video) => ({
    ...video,
    genre: genresById.get(Number(video.id)) ?? null,
  }));
}

export async function GET(request: NextRequest) {
  const auth = await requireAuthOnly(request, {
    authMode: "admin",
    adminPermission: "admin.videos.catalog.read",
  });

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
      approved: true,
      parsedArtist: true,
      parsedTrack: true,
      parsedVideoType: true,
      parseConfidence: true,
      channelTitle: true,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const videosWithGenres = await attachGenresToVideos(videos as AdminVideoListRow[]);

  return NextResponse.json({ videos: videosWithGenres });
}

export async function PATCH(request: NextRequest) {
  const result = await withAuthAndBody(request, updateSchema, {
    authMode: "admin",
    adminPermission: "admin.videos.catalog.edit",
  });

  if (!result.ok) {
    return result.response;
  }

  const parsed = result.data;

  const data: {
    title?: string;
    approved?: boolean;
    approvedAt?: Date | null;
    parsedArtist?: string | null;
    parsedTrack?: string | null;
    parsedVideoType?: string | null;
    parseConfidence?: number | null;
    channelTitle?: string | null;
    description?: string | null;
    parsedAt?: Date;
    parseMethod?: string;
  } = {};

  if (parsed.title !== undefined) data.title = parsed.title;
  if (parsed.approved !== undefined) data.approved = parsed.approved;
  if (parsed.approved === true) {
    data.approvedAt = new Date();
  }
  if (parsed.parsedArtist !== undefined) data.parsedArtist = parsed.parsedArtist || null;
  if (parsed.parsedTrack !== undefined) data.parsedTrack = parsed.parsedTrack || null;
  if (parsed.parsedVideoType !== undefined) data.parsedVideoType = parsed.parsedVideoType || null;
  if (parsed.parseConfidence !== undefined) data.parseConfidence = parsed.parseConfidence;
  if (parsed.channelTitle !== undefined) data.channelTitle = parsed.channelTitle || null;
  if (parsed.description !== undefined) data.description = parsed.description || null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }
  data.parsedAt = new Date();
  data.parseMethod = "admin-manual";

  const updated = await prisma.video
    .update({
      where: { id: parsed.id },
      data,
      select: {
        id: true,
        videoId: true,
        title: true,
        approved: true,
        parsedArtist: true,
        parsedTrack: true,
        parsedVideoType: true,
        parseConfidence: true,
        channelTitle: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    .catch(() => null);

  if (!updated) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  if (parsed.genre !== undefined) {
    await prisma.$executeRaw`
      UPDATE videos
      SET genre = ${parsed.genre || null},
          updated_at = UTC_TIMESTAMP(3)
      WHERE id = ${parsed.id}
    `.catch(() => undefined);
  }

  const [updatedWithGenre] = await attachGenresToVideos([updated]);

  clearCatalogVideoCaches();
  clearCurrentVideoRouteCaches();

  // If this update approved a previously-unapproved video, trigger artist discovery
  // to find more tracks by the same artist (only if this is the first approval).
  if (parsed.approved === true && updated?.videoId) {
    const discoveryArtistName = (parsed.parsedArtist ?? updated.parsedArtist ?? "").trim();
    if (discoveryArtistName) {
      triggerArtistDiscoveryIfNew(discoveryArtistName, updated.videoId);
    }
  }

  return NextResponse.json({ ok: true, video: updatedWithGenre });
}

export async function DELETE(request: NextRequest) {
  const result = await withAuthAndBody(request, deleteSchema, {
    authMode: "admin",
    adminPermission: "admin.videos.catalog.delete",
  });

  if (!result.ok) {
    return result.response;
  }

  const parsed = result.data;

  const pruneResult = await pruneVideoAndAssociationsByVideoId(parsed.videoId, "admin-hard-delete");

  const pruneResponse = mapAdminPruneResultToDeleteResponse(pruneResult, {
    ok: true,
    deletedVideoRows: pruneResult.deletedVideoRows,
  });

  if (!pruneResponse.deleted) {
    return pruneResponse.response;
  }

  clearCurrentVideoRouteCaches();

  return pruneResponse.response;
}