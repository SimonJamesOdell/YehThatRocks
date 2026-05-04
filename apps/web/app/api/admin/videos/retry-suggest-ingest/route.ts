import { NextRequest, NextResponse } from "next/server";

import { adminRetrySuggestIngestSchema } from "@/lib/api-schemas";
import { requireAdminApiAuth } from "@/lib/admin-auth";
import {
  importVideoFromDirectSource,
  hasDatabaseUrl,
  pruneVideoAndAssociationsByVideoId,
} from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { parseRequestJson } from "@/lib/request-json";

function getRejectionReason(decision: { reason: string; message?: string }) {
  if (decision.message?.trim()) {
    return decision.message.trim();
  }

  switch (decision.reason) {
    case "missing-metadata":
      return "Rejected: required artist or track metadata is missing.";
    case "low-confidence":
      return "Rejected: classification confidence is too low.";
    case "unknown-video-type":
      return "Rejected: video type is not eligible for the catalog.";
    case "unavailable":
      return "Rejected: video is unavailable for playback.";
    case "not-found":
      return "Rejected: video could not be found.";
    case "invalid-video-id":
      return "Rejected: invalid YouTube video ID or URL.";
    default:
      return "Rejected during ingestion/classification.";
  }
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

  const parsed = adminRetrySuggestIngestSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { videoId } = parsed.data;

  if (hasDatabaseUrl()) {
    await prisma.$executeRaw`
      DELETE FROM rejected_videos
      WHERE video_id = ${videoId}
    `;

    await pruneVideoAndAssociationsByVideoId(videoId, "admin-retry-suggest-ingest-clear").catch(() => ({
      pruned: false,
      deletedVideoRows: 0,
      reason: "clear-failed",
    }));
  }

  const result = await importVideoFromDirectSource(videoId, {
    discoverRelated: false,
    forceApprove: true,
  });

  if (!result.videoId) {
    return NextResponse.json({ error: "Invalid YouTube URL or video id." }, { status: 400 });
  }

  const metadataRows = hasDatabaseUrl()
    ? await prisma.$queryRaw<Array<{ parsedArtist: string | null; parsedTrack: string | null }>>`
        SELECT parsedArtist, parsedTrack
        FROM videos
        WHERE videoId = ${result.videoId}
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `
    : [];

  const metadata = metadataRows[0];
  const submissionStatus = result.decision.allowed ? "ingested" : "rejected";

  return NextResponse.json({
    ok: true,
    kind: "video",
    videoId: result.videoId,
    submissionStatus,
    rejectionCode: submissionStatus === "rejected" ? result.decision.reason : null,
    rejectionReason: submissionStatus === "rejected" ? getRejectionReason(result.decision) : null,
    artist: submissionStatus === "rejected" ? null : metadata?.parsedArtist ?? null,
    track: submissionStatus === "rejected" ? null : metadata?.parsedTrack ?? null,
    decision: result.decision,
  });
}
