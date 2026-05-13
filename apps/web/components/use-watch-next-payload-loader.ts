"use client";

import { useCallback } from "react";
import type { VideoRecord } from "@/lib/catalog";

type CurrentVideoResolvePayloadLike = {
  relatedVideos?: VideoRecord[];
  watchNextAdvisory?: unknown;
  hasMore?: boolean;
  denied?: unknown;
  pending?: boolean;
};

type LogWatchNext = (event: string, detail?: Record<string, unknown>) => void;

type UseWatchNextPayloadLoaderParams = {
  relatedFetchTimeoutMs: number;
  coldRetryAttempts: number;
  coldRetryBaseDelayMs: number;
  logWatchNext: LogWatchNext;
};

export function useWatchNextPayloadLoader({
  relatedFetchTimeoutMs,
  coldRetryAttempts,
  coldRetryBaseDelayMs,
  logWatchNext,
}: UseWatchNextPayloadLoaderParams) {
  const loadWatchNextPayload = useCallback(async ({
    currentVideoId,
    params,
    isFirstColdFetch,
  }: {
    currentVideoId: string;
    params: URLSearchParams;
    isFirstColdFetch: boolean;
  }) => {
    const tryFetchPayload = async () => {
      const abortController = new AbortController();
      const fetchStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      const timeoutId = window.setTimeout(() => {
        abortController.abort();
      }, relatedFetchTimeoutMs);

      try {
        const response = await fetch(`/api/current-video?${params.toString()}`, {
          cache: "no-store",
          signal: abortController.signal,
        });
        const elapsedMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - fetchStartedAt);
        logWatchNext("fetch:response", {
          currentVideoId,
          status: response.status,
          ok: response.ok,
          elapsedMs,
          request: params.toString(),
        });
        if (!response.ok) {
          throw new Error("watch-next-load-failed");
        }

        const json = (await response.json()) as CurrentVideoResolvePayloadLike;
        logWatchNext("fetch:payload", {
          currentVideoId,
          pending: Boolean(json?.pending),
          relatedCount: Array.isArray(json?.relatedVideos) ? json.relatedVideos.length : null,
          hasMore: typeof json?.hasMore === "boolean" ? json.hasMore : null,
          denied: json?.denied ?? null,
        });

        if (json && typeof json === "object" && "pending" in json && Boolean(json.pending)) {
          throw new Error("watch-next-server-busy");
        }

        return json;
      } catch (error) {
        const elapsedMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - fetchStartedAt);
        logWatchNext("fetch:error", {
          currentVideoId,
          elapsedMs,
          request: params.toString(),
          error: error instanceof Error ? error.message : String(error),
          aborted: abortController.signal.aborted,
        });
        throw error;
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    let payload: CurrentVideoResolvePayloadLike | null = null;
    const maxAttempts = isFirstColdFetch ? coldRetryAttempts : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        logWatchNext("fetch:attempt", {
          currentVideoId,
          attempt,
          maxAttempts,
          request: params.toString(),
        });
        payload = await tryFetchPayload();
        break;
      } catch (error) {
        if (attempt >= maxAttempts) {
          logWatchNext("fetch:attempt-failed-final", {
            currentVideoId,
            attempt,
            maxAttempts,
            error: error instanceof Error ? error.message : String(error),
          });
          throw new Error("watch-next-load-exhausted");
        }

        const retryDelayMs = Math.min(3_000, coldRetryBaseDelayMs * (2 ** (attempt - 1)));
        logWatchNext("fetch:attempt-retry", {
          currentVideoId,
          attempt,
          maxAttempts,
          retryDelayMs,
          error: error instanceof Error ? error.message : String(error),
        });

        await new Promise<void>((resolve) => {
          window.setTimeout(() => {
            resolve();
          }, retryDelayMs);
        });
      }
    }

    if (!payload) {
      throw new Error("watch-next-load-empty-payload");
    }

    return payload;
  }, [coldRetryAttempts, coldRetryBaseDelayMs, logWatchNext, relatedFetchTimeoutMs]);

  return {
    loadWatchNextPayload,
  };
}
