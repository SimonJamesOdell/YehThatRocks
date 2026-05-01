import { prisma } from "@/lib/db";

export const PENDING_VIDEO_APPROVAL_WHERE_CLAUSE = "(approved = 0 OR approved IS NULL)";
export const PENDING_VIDEO_QUEUE_INDEX_NAME = "idx_videos_pending_approval_queue";

let pendingQueueIndexReady = false;
let pendingQueueIndexInFlight: Promise<void> | null = null;

function isDuplicateIndexError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /Duplicate key name|already exists/i.test(error.message);
}

async function ensurePendingVideoQueueIndexInternal() {
  const existing = await prisma.$queryRawUnsafe<Array<{ Key_name?: string }>>(
    "SHOW INDEX FROM videos WHERE Key_name = ?",
    PENDING_VIDEO_QUEUE_INDEX_NAME,
  );

  if (existing.length > 0) {
    pendingQueueIndexReady = true;
    return;
  }

  try {
    await prisma.$executeRawUnsafe(
      `CREATE INDEX ${PENDING_VIDEO_QUEUE_INDEX_NAME} ON videos (approved, created_at, id)`,
    );
  } catch (error) {
    if (!isDuplicateIndexError(error)) {
      return;
    }
  }

  pendingQueueIndexReady = true;
}

export async function ensurePendingVideoQueueIndex() {
  if (pendingQueueIndexReady) {
    return;
  }

  if (!pendingQueueIndexInFlight) {
    pendingQueueIndexInFlight = ensurePendingVideoQueueIndexInternal().finally(() => {
      pendingQueueIndexInFlight = null;
    });
  }

  await pendingQueueIndexInFlight;
}

export function resetPendingVideoQueueIndexEnsureState() {
  pendingQueueIndexReady = false;
  pendingQueueIndexInFlight = null;
}
