import { prisma } from "@/lib/db";

let catalogReviewQueueReady = false;
let catalogReviewQueuePrimed = false;
let ensureQueueInFlight: Promise<void> | null = null;

async function ensureCatalogReviewQueueInternal() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS admin_catalog_review_queue (
      video_id VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
      enqueued_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (video_id),
      KEY idx_admin_catalog_review_queue_enqueued_at (enqueued_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS admin_catalog_review_queue_meta (
      id INT NOT NULL,
      initialized_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  catalogReviewQueueReady = true;
}

async function primeCatalogReviewQueueInternal() {
  await prisma.$executeRawUnsafe(`
    INSERT IGNORE INTO admin_catalog_review_queue (video_id)
    SELECT v.videoId
    FROM videos v
    WHERE v.videoId IS NOT NULL
      AND v.videoId <> ''
  `);

  await prisma.$executeRawUnsafe(`
    DELETE q
    FROM admin_catalog_review_queue q
    LEFT JOIN videos v ON v.videoId = q.video_id
    WHERE v.id IS NULL
  `);

  await prisma.$executeRawUnsafe(
    "INSERT IGNORE INTO admin_catalog_review_queue_meta (id) VALUES (1)",
  );

  catalogReviewQueuePrimed = true;
}

export async function ensureCatalogReviewQueueReady() {
  if (catalogReviewQueueReady && catalogReviewQueuePrimed) {
    return;
  }

  if (!ensureQueueInFlight) {
    ensureQueueInFlight = (async () => {
      if (!catalogReviewQueueReady) {
        await ensureCatalogReviewQueueInternal();
      }

      const metaRows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
        "SELECT id FROM admin_catalog_review_queue_meta WHERE id = 1 LIMIT 1",
      );
      const shouldPrimeQueue = metaRows.length === 0;

      if (!catalogReviewQueuePrimed && shouldPrimeQueue) {
        await primeCatalogReviewQueueInternal();
      } else {
        catalogReviewQueuePrimed = true;
      }
    })().finally(() => {
      ensureQueueInFlight = null;
    });
  }

  await ensureQueueInFlight;
}

export function resetCatalogReviewQueueEnsureState() {
  catalogReviewQueueReady = false;
  catalogReviewQueuePrimed = false;
  ensureQueueInFlight = null;
}
