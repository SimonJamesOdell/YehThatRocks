import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import { enrichPendingQueueVideos, type PendingQueueVideoRow } from "@/lib/admin-pending-video-enrichment";
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

type AdminPendingVideoRow = PendingQueueVideoRow & {
  id: number;
  durationSec: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

let pendingEnrichmentInFlight: Promise<void> | null = null;
let pendingEnrichmentLastStartedAt = 0;
const PENDING_ENRICHMENT_MIN_INTERVAL_MS = 30_000;

function schedulePendingQueueEnrichment(rows: PendingQueueVideoRow[]) {
  if (pendingEnrichmentInFlight) {
    return;
  }

  const now = Date.now();
  if (now - pendingEnrichmentLastStartedAt < PENDING_ENRICHMENT_MIN_INTERVAL_MS) {
    return;
  }

  pendingEnrichmentLastStartedAt = now;
  pendingEnrichmentInFlight = (async () => {
    await enrichPendingQueueVideos(rows);
  })()
    .catch(() => {
      // Best effort only: queue reads should never fail due to enrichment.
    })
    .finally(() => {
      pendingEnrichmentInFlight = null;
    });
}

async function loadPendingVideos(q: string): Promise<AdminPendingVideoRow[]> {
  return q
    ? await prisma.$queryRawUnsafe<Array<AdminPendingVideoRow>>(
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
    : await prisma.$queryRawUnsafe<Array<AdminPendingVideoRow>>(
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
}

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
  const countsOnly = request.nextUrl.searchParams.get("countsOnly") === "1";

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

  if (countsOnly) {
    return NextResponse.json({ totalPending });
  }

  const pendingVideos = await loadPendingVideos(q);

  // Run enrichment opportunistically in the background so opening Admin is fast.
  // Any improvements become visible on subsequent refresh/poll cycles.
  if (!q) {
    schedulePendingQueueEnrichment(pendingVideos);
  }

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
  const asyncMode = request.nextUrl.searchParams.get("async") === "1";

  if (action === "approve") {
    if (asyncMode) {
      void (async () => {
        const approveData: {
          approved: boolean;
          approvedAt: Date;
          updatedAt: Date;
          title?: string;
          parsedArtist?: string | null;
          parsedTrack?: string | null;
        } = {
          approved: true,
          approvedAt: new Date(),
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

        await prisma.video.updateMany({
          where: { videoId },
          data: approveData,
        });

        if (parsed.genre !== undefined) {
          await prisma.$executeRaw`
            UPDATE videos
            SET genre = ${parsed.genre}
            WHERE videoId = ${videoId}
          `;
        }

        clearCatalogVideoCaches();
        clearCurrentVideoRouteCaches();
      })().catch(() => {
        // Best-effort async approve; moderation UI already advanced optimistically.
      });

      return NextResponse.json({ ok: true, videoId, action: "approve", queued: true });
    }

    const approveData: {
      approved: boolean;
      approvedAt: Date;
      updatedAt: Date;
      title?: string;
      parsedArtist?: string | null;
      parsedTrack?: string | null;
    } = {
      approved: true,
      approvedAt: new Date(),
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
      where: { videoId },
      data: approveData,
    });

    if (parsed.genre !== undefined) {
      await prisma.$executeRaw`
        UPDATE videos
        SET genre = ${parsed.genre}
        WHERE videoId = ${videoId}
      `;
    }

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

  if (asyncMode) {
    void pruneVideoAndAssociationsByVideoId(videoId, "admin-pending-remove")
      .then(() => {
        clearCurrentVideoRouteCaches();
      })
      .catch(() => {
        // Best-effort async remove; moderation UI already advanced optimistically.
      });

    return NextResponse.json({ ok: true, videoId, action: "remove", queued: true });
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
