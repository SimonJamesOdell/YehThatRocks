import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { mapAdminPruneResultToDeleteResponse } from "@/lib/admin-prune-delete-response";
import { fetchGenreReviewCurrentVideo } from "@/lib/admin-genre-review-current-video";
import { ensureGenreReviewQueueReady } from "@/lib/admin-genre-review-queue";
import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import { pruneVideoAndAssociationsByVideoId } from "@/lib/catalog-data";
import { clearCurrentVideoRouteCaches } from "@/lib/current-video-cache";
import { prisma } from "@/lib/db";
import { getMusicBrainzArtistData } from "@/lib/musicbrainz";

const ROCK_METAL_PATTERN = /\b(rock|metal|doom|death|black|thrash|sludge|stoner|hardcore|punk|grind|djent|nu metal|metalcore|post metal|heavy|prog|progressive|gothic|folk metal|power metal|industrial metal|symphonic metal)\b/i;

type GenreSignal = {
  source: string;
  genre: string;
  confidence: number;
};

type GenreSuggestion = {
  proposedGenre: string | null;
  confidence: number;
  reason: string;
};

function normalizeGenreLabel(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\s+/g, " ");
}

function normalizeArtistKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function suggestGenreForVideo(videoId: string): Promise<GenreSuggestion> {
  const videoRows = await prisma.$queryRawUnsafe<Array<{
    genre: string | null;
    parsedArtist: string | null;
  }>>(
    `SELECT genre, parsedArtist
     FROM videos
     WHERE videoId = ?
     LIMIT 1`,
    videoId,
  );

  const video = videoRows[0];
  if (!video) {
    return {
      proposedGenre: null,
      confidence: 0,
      reason: "no-video",
    };
  }

  const signals: GenreSignal[] = [];
  const existingGenre = normalizeGenreLabel(video.genre);
  if (existingGenre) {
    signals.push({ source: "video-existing", genre: existingGenre, confidence: 0.55 });
  }

  const normalizedArtist = normalizeArtistKey(video.parsedArtist);
  if (normalizedArtist) {
    const artistStatsRows = await prisma.$queryRawUnsafe<Array<{ genre: string | null }>>(
      `SELECT genre
       FROM artist_stats
       WHERE normalized_artist = ?
         AND genre IS NOT NULL
         AND TRIM(genre) <> ''
       LIMIT 1`,
      normalizedArtist,
    );

    const artistStatsGenre = normalizeGenreLabel(artistStatsRows[0]?.genre);
    if (artistStatsGenre) {
      signals.push({ source: "artist-stats", genre: artistStatsGenre, confidence: 0.86 });
    }

    const mb = await getMusicBrainzArtistData(String(video.parsedArtist ?? ""));
    const mbGenre = normalizeGenreLabel(mb?.tags?.[0]);
    if (mbGenre) {
      const mbConfidence = mb?.isRockOrMetal ? 0.9 : 0.75;
      signals.push({ source: "musicbrainz", genre: mbGenre, confidence: mbConfidence });
    }
  }

  if (signals.length === 0) {
    return {
      proposedGenre: null,
      confidence: 0,
      reason: "no-sources",
    };
  }

  const grouped = new Map<string, { genre: string; weight: number; support: number }>();
  let totalWeight = 0;

  for (const signal of signals) {
    const key = signal.genre.toLowerCase();
    const current = grouped.get(key) ?? { genre: signal.genre, weight: 0, support: 0 };
    current.weight += signal.confidence;
    current.support += 1;
    grouped.set(key, current);
    totalWeight += signal.confidence;
  }

  const ranked = Array.from(grouped.values()).sort((left, right) => (
    right.weight - left.weight || right.support - left.support
  ));
  const top = ranked[0];

  if (!top || totalWeight <= 0) {
    return {
      proposedGenre: null,
      confidence: 0,
      reason: "no-top-genre",
    };
  }

  let confidence = top.weight / totalWeight;
  if (top.support >= 2) {
    confidence += 0.08;
  }
  confidence = Math.max(0, Math.min(1, confidence));

  const normalizedTop = normalizeGenreLabel(top.genre);
  const isRockOrMetal = normalizedTop ? ROCK_METAL_PATTERN.test(normalizedTop) : false;
  const reasonPrefix = confidence >= 0.9
    ? (isRockOrMetal ? "high-confidence-update" : "high-confidence-non-rock")
    : "manual-review";

  return {
    proposedGenre: normalizedTop,
    confidence,
    reason: `${reasonPrefix}:${normalizedTop ?? "unknown"}`,
  };
}

const moderateGenreReviewSchema = z.object({
  videoId: z.string().trim().min(1).max(64),
  action: z.enum(["approve", "remove", "swap-artist-track"]),
  genre: z.string().trim().min(1).max(255).nullable().optional(),
});

async function getGenreReviewRemaining() {
  const rows = await prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
    `SELECT COUNT(*) AS total FROM admin_genre_review_queue`,
  );
  return Number(rows[0]?.total ?? 0);
}

async function getWorkerState() {
  const rows = await prisma.$queryRawUnsafe<Array<{
    status: string;
    total_videos: bigint | number;
    last_video_id: bigint | number;
    processed_count: bigint | number;
    updated_count: bigint | number;
    deleted_count: bigint | number;
    queued_count: bigint | number;
    started_at: Date | null;
    updated_at: Date | null;
    last_message: string | null;
  }>>(
    `SELECT status, total_videos, last_video_id, processed_count, updated_count, deleted_count, queued_count, started_at, updated_at, last_message
     FROM admin_genre_reclassify_state
     WHERE id = 1
     LIMIT 1`,
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    status: row.status,
    totalVideos: Number(row.total_videos ?? 0),
    lastVideoId: Number(row.last_video_id ?? 0),
    processedCount: Number(row.processed_count ?? 0),
    updatedCount: Number(row.updated_count ?? 0),
    deletedCount: Number(row.deleted_count ?? 0),
    queuedCount: Number(row.queued_count ?? 0),
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    lastMessage: row.last_message,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAuthOnly(request);

  if (!auth.ok) {
    return auth.response;
  }

  await ensureGenreReviewQueueReady();

  const [remaining, currentVideo, worker] = await Promise.all([
    getGenreReviewRemaining(),
    fetchGenreReviewCurrentVideo(),
    getWorkerState(),
  ]);

  return NextResponse.json({
    remaining,
    currentVideo,
    worker,
  });
}

export async function POST(request: NextRequest) {
  const result = await withAuthAndBody(request, moderateGenreReviewSchema);

  if (!result.ok) {
    return result.response;
  }

  await ensureGenreReviewQueueReady();

  const { videoId, action, genre } = result.data;

  if (action === "swap-artist-track") {
    const swapResult = await prisma.$executeRawUnsafe(
      `UPDATE videos
       SET parsedArtist = parsedTrack,
           parsedTrack = parsedArtist,
           updated_at = UTC_TIMESTAMP(3)
       WHERE videoId = ?`,
      videoId,
    );

    if (swapResult === 0) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    const suggestion = await suggestGenreForVideo(videoId);

    await prisma.$executeRawUnsafe(
      `INSERT INTO admin_genre_review_queue (video_id, proposed_genre, confidence, reason)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         proposed_genre = VALUES(proposed_genre),
         confidence = VALUES(confidence),
         reason = VALUES(reason),
         updated_at = UTC_TIMESTAMP(3)`,
      videoId,
      suggestion.proposedGenre,
      suggestion.confidence,
      suggestion.reason,
    );

    const remaining = await getGenreReviewRemaining();
    const currentVideo = await fetchGenreReviewCurrentVideo();

    return NextResponse.json({
      ok: true,
      action: "swap-artist-track",
      videoId,
      remaining,
      currentVideo,
      suggestion,
    });
  }

  if (action === "approve") {
    if (genre && genre.trim().length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE videos SET genre = ?, updated_at = UTC_TIMESTAMP(3) WHERE videoId = ?`,
        genre.trim(),
        videoId,
      );
    }

    const queueDelete = await prisma.$executeRawUnsafe(
      `DELETE FROM admin_genre_review_queue WHERE video_id = ?`,
      videoId,
    );

    if (queueDelete === 0) {
      return NextResponse.json({ error: "Video is not in the genre review queue" }, { status: 404 });
    }

    const remaining = await getGenreReviewRemaining();

    return NextResponse.json({
      ok: true,
      action: "approve",
      videoId,
      remaining,
    });
  }

  const pruneResult = await pruneVideoAndAssociationsByVideoId(videoId, "admin-genre-review-remove");
  const pruneResponse = mapAdminPruneResultToDeleteResponse(pruneResult, {
    ok: true,
    action: "remove",
    videoId,
    deletedVideoRows: pruneResult.deletedVideoRows,
  });

  if (!pruneResponse.deleted) {
    return pruneResponse.response;
  }

  await prisma.$executeRawUnsafe(
    `DELETE FROM admin_genre_review_queue WHERE video_id = ?`,
    videoId,
  );

  clearCurrentVideoRouteCaches();

  const remaining = await getGenreReviewRemaining();

  return NextResponse.json({
    ok: true,
    action: "remove",
    videoId,
    deletedVideoRows: pruneResult.deletedVideoRows,
    remaining,
  });
}
