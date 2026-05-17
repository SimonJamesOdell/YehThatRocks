import { prisma } from "@/lib/db";

type QueueEntryRow = {
  video_id: string;
  enqueued_at: Date;
};

type VideoWithDurationRow = {
  id: number;
  videoId: string;
  title: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
  channelTitle: string | null;
  durationSec: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type CatalogReviewCurrentVideo = {
  id: number;
  videoId: string;
  title: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
  channelTitle: string | null;
  durationSec: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  enqueuedAt: Date;
};

/**
 * Returns the next video from the catalog review queue, or null if the queue is empty.
 *
 * Uses two targeted queries instead of a single multi-table JOIN to avoid a full
 * watch_history table scan on every call:
 *
 * 1. Get the first queue entry — O(1) via idx_admin_catalog_review_queue_enqueued_at.
 * 2. Fetch video details + a correlated duration subquery scoped to that one video_id —
 *    both the UNIQUE index on videos.videoId and the index on watch_history.video_id are
 *    used, so the watch_history scan is bounded to at most a handful of rows.
 */
export async function fetchCatalogReviewCurrentVideo(): Promise<CatalogReviewCurrentVideo | null> {
  // Step 1: identify the next queued video_id that still has a matching video.
  // The JOIN skips orphaned queue entries (videos deleted outside of the catalog review
  // flow) so they don't permanently block the queue.
  const queueRows = await prisma.$queryRawUnsafe<QueueEntryRow[]>(
    `SELECT q.video_id, q.enqueued_at
     FROM admin_catalog_review_queue q
     JOIN videos v ON v.videoId = q.video_id
     ORDER BY q.enqueued_at ASC, q.video_id ASC
     LIMIT 1`,
  );

  const entry = queueRows[0];
  if (!entry) return null;

  // Step 2: fetch full video row + targeted duration lookup for this specific video only.
  // The correlated subquery uses watch_history.video_id index instead of scanning the whole table.
  const videoRows = await prisma.$queryRawUnsafe<VideoWithDurationRow[]>(
    `SELECT
      v.id,
      v.videoId,
      v.title,
      v.parsedArtist,
      v.parsedTrack,
      v.channelTitle,
      (SELECT MAX(last_duration_sec)
       FROM watch_history
       WHERE video_id = ?
         AND last_duration_sec > 0) AS durationSec,
      v.created_at AS createdAt,
      v.updated_at AS updatedAt
    FROM videos v
    WHERE v.videoId = ?
    LIMIT 1`,
    entry.video_id,
    entry.video_id,
  );

  const video = videoRows[0];
  if (!video) return null;

  return {
    ...video,
    enqueuedAt: entry.enqueued_at,
  };
}
