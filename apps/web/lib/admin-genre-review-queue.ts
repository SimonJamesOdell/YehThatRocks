import { prisma } from "@/lib/db";

let genreReviewQueueReady = false;
let ensureGenreReviewInFlight: Promise<void> | null = null;

async function ensureGenreReviewQueueInternal() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS admin_genre_review_queue (
      video_id VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
      proposed_genre VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL,
      confidence DECIMAL(6,4) NULL,
      reason VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL,
      enqueued_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (video_id),
      KEY idx_admin_genre_review_queue_enqueued_at (enqueued_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  genreReviewQueueReady = true;
}

export async function ensureGenreReviewQueueReady() {
  if (genreReviewQueueReady) {
    return;
  }

  if (!ensureGenreReviewInFlight) {
    ensureGenreReviewInFlight = ensureGenreReviewQueueInternal().finally(() => {
      ensureGenreReviewInFlight = null;
    });
  }

  await ensureGenreReviewInFlight;
}

export function resetGenreReviewQueueEnsureState() {
  genreReviewQueueReady = false;
  ensureGenreReviewInFlight = null;
}
