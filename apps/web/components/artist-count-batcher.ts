"use client";

import { parseJsonOrNull } from "@/lib/parse-json";

const artistCountCache = new Map<string, number | null>();
const artistCountInFlight = new Map<string, Promise<number | null>>();

type BatchItem = {
  artistSlug: string;
  videoId: string;
  key: string;
  resolve: (count: number | null) => void;
};

let pendingBatch: BatchItem[] = [];
let batchFlushTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_ENDPOINT = "/api/artists/batch";

function scheduleFlush() {
  if (batchFlushTimer !== null) return;
  batchFlushTimer = setTimeout(() => {
    batchFlushTimer = null;
    const batch = pendingBatch;
    pendingBatch = [];
    void executeBatch(batch);
  }, 0);
}

async function executeBatch(batch: BatchItem[]) {
  if (batch.length === 0) return;

  // Deduplicate within the batch
  const uniqueKeys = new Map<string, BatchItem>();
  for (const item of batch) {
    if (!uniqueKeys.has(item.key)) {
      uniqueKeys.set(item.key, item);
    } else {
      // Duplicate — chain the resolve so both callers get the result
      const existing = uniqueKeys.get(item.key)!;
      const originalResolve = existing.resolve;
      existing.resolve = (count) => {
        originalResolve(count);
        item.resolve(count);
      };
    }
  }

  const items = Array.from(uniqueKeys.values());
  const itemsParam = items.map((item) => `${encodeURIComponent(item.artistSlug)}:${encodeURIComponent(item.videoId)}`).join(",");

  try {
    const response = await fetch(`${BATCH_ENDPOINT}?items=${itemsParam}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      for (const item of items) {
        artistCountCache.set(item.key, null);
        item.resolve(null);
      }
      return;
    }

    const payload = await parseJsonOrNull<{
      results?: Record<string, { videoCount: number | null; error?: string }>;
    }>(response);

    if (!payload?.results) {
      for (const item of items) {
        artistCountCache.set(item.key, null);
        item.resolve(null);
      }
      return;
    }

    for (const item of items) {
      const result = payload.results[item.key];
      const count = result?.videoCount != null && Number.isFinite(result.videoCount)
        ? result.videoCount
        : null;
      artistCountCache.set(item.key, count);
      item.resolve(count);
    }
  } catch {
    for (const item of items) {
      artistCountCache.set(item.key, null);
      item.resolve(null);
    }
  }
}

export function fetchArtistVideoCountBatched(artistSlug: string, videoId: string): Promise<number | null> {
  const key = `${artistSlug}:${videoId}`;

  // Check cache first
  if (artistCountCache.has(key)) {
    return Promise.resolve(artistCountCache.get(key) ?? null);
  }

  // Check in-flight
  const existing = artistCountInFlight.get(key);
  if (existing) {
    return existing;
  }

  const promise = new Promise<number | null>((resolve) => {
    pendingBatch.push({ artistSlug, videoId, key, resolve });
    scheduleFlush();
  }).finally(() => {
    artistCountInFlight.delete(key);
  });

  artistCountInFlight.set(key, promise);
  return promise;
}

// Exported for testing / cache clearing
export function clearArtistCountCache() {
  artistCountCache.clear();
}
