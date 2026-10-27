/**
 * Walker dump + slow-drip delivery.
 *
 * When the proxy confidently detects the catalog walker it answers with one
 * big blob of synthetic catalog. By default that blob is then *dripped* out a
 * few kilobytes at a time, so the walker's connection stays pinned open while
 * it "downloads" the decoy catalog. This hampers its throughput without ever
 * touching its machine — it is just a very slow response to its own request.
 *
 * A global concurrency cap guards the other direction: an unbounded slow-drip
 * would let a botnet hold every connection slot open and DoS us instead.
 * Past the cap we degrade gracefully to the instant (still fake) dump.
 */

import { NextResponse } from "next/server";

import { buildDecoyCatalogDump } from "@/lib/decoy-artists";

const DUMP_DEFAULT_BYTES = 256 * 1024;
const DUMP_MIN_BYTES = 16 * 1024;
const DUMP_MAX_BYTES = 64 * 1024 * 1024;

const DRIP_DEFAULT_CHUNK_BYTES = 4096;
const DRIP_DEFAULT_INTERVAL_MS = 400;
const DRIP_MAX_CONCURRENT_DEFAULT = 20;
const DRIP_MIN_INTERVAL_MS = 25;
const DRIP_MAX_INTERVAL_MS = 5000;

let activeSlowDrips = 0;

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  return raw !== "0" && raw !== "false";
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

export function isWalkerDumpEnabled(): boolean {
  return envFlag("DECOY_DUMP_ENABLED", true);
}

export function isSlowDripEnabled(): boolean {
  return envFlag("DECOY_DRIP_ENABLED", true);
}

export function slowDripSlotAvailable(): boolean {
  const max = envInt("DECOY_DRIP_MAX_CONCURRENT", DRIP_MAX_CONCURRENT_DEFAULT, 1, 10_000);
  return activeSlowDrips < max;
}

function createSlowDripStream(body: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunkBytes = envInt("DECOY_DRIP_CHUNK_BYTES", DRIP_DEFAULT_CHUNK_BYTES, 1, 1024 * 1024);
  const intervalMs = envInt("DECOY_DRIP_INTERVAL_MS", DRIP_DEFAULT_INTERVAL_MS, DRIP_MIN_INTERVAL_MS, DRIP_MAX_INTERVAL_MS);

  activeSlowDrips += 1;
  let released = false;
  const release = () => {
    if (released) {
      return;
    }
    released = true;
    activeSlowDrips = Math.max(0, activeSlowDrips - 1);
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let offset = 0;
      const timer = setInterval(() => {
        if (offset >= body.length) {
          clearInterval(timer);
          release();
          controller.close();
          return;
        }

        const chunk = body.slice(offset, offset + chunkBytes);
        offset += chunkBytes;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch (err) {
          clearInterval(timer);
          release();
          controller.error(err instanceof Error ? err : new Error(String(err)));
        }
      }, intervalMs);
    },
    cancel() {
      release();
    },
  });
}

/**
 * Build the walker response: the decoy catalog, dripped slowly when a slot is
 * available, otherwise handed over in one instant (still fake) blob.
 */
export function buildWalkerDumpResponse(): NextResponse {
  const targetBytes = envInt("DECOY_DUMP_BYTES", DUMP_DEFAULT_BYTES, DUMP_MIN_BYTES, DUMP_MAX_BYTES);
  const body = buildDecoyCatalogDump(targetBytes);

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Ytr-Volunteer": "enjoy the full catalog, friend (one drop at a time)",
  };

  if (isSlowDripEnabled() && slowDripSlotAvailable()) {
    return new NextResponse(createSlowDripStream(body), { status: 200, headers });
  }

  return new NextResponse(body, { status: 200, headers });
}
