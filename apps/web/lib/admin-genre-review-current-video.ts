import { prisma } from "@/lib/db";

export type GenreReviewCurrentVideo = {
  id: number;
  videoId: string;
  title: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
  channelTitle: string | null;
  durationSec: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  proposedGenre: string | null;
  confidence: number | null;
  reason: string | null;
  enqueuedAt: Date;
};

export async function fetchGenreReviewCurrentVideo(): Promise<GenreReviewCurrentVideo | null> {
  const rows = await prisma.$queryRawUnsafe<Array<GenreReviewCurrentVideo>>(
    `SELECT
      v.id,
      v.videoId,
      v.title,
      v.parsedArtist,
      v.parsedTrack,
      v.channelTitle,
      (SELECT MAX(last_duration_sec)
       FROM watch_history
       WHERE video_id = q.video_id
         AND last_duration_sec > 0) AS durationSec,
      v.created_at AS createdAt,
      v.updated_at AS updatedAt,
      q.proposed_genre AS proposedGenre,
      q.confidence AS confidence,
      q.reason AS reason,
      q.enqueued_at AS enqueuedAt
    FROM admin_genre_review_queue q
    JOIN videos v ON v.videoId = q.video_id
    ORDER BY q.enqueued_at ASC, q.video_id ASC
    LIMIT 1`,
  );

  return rows[0] ?? null;
}
