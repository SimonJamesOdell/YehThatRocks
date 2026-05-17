type DashboardResponsePayload = Record<string, unknown>;

import { clamp } from "@/lib/number-utils";

type CacheEntry = {
  expiresAt: number;
  payload: DashboardResponsePayload;
};

const DEFAULT_TTL_MS = 1_000;
const MIN_TTL_MS = 250;
const MAX_TTL_MS = 10_000;

export function readDashboardResponseCacheTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ADMIN_DASHBOARD_RESPONSE_CACHE_TTL_MS;
  if (!raw) {
    return DEFAULT_TTL_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TTL_MS;
  }

  return clamp(Math.floor(parsed), MIN_TTL_MS, MAX_TTL_MS);
}

let cacheEntry: CacheEntry | null = null;
let inFlightPayload: Promise<DashboardResponsePayload> | null = null;

export function getCachedDashboardResponsePayload(now = Date.now()): DashboardResponsePayload | null {
  if (!cacheEntry || cacheEntry.expiresAt <= now) {
    cacheEntry = null;
    return null;
  }

  return cacheEntry.payload;
}

export function setCachedDashboardResponsePayload(
  payload: DashboardResponsePayload,
  options?: { now?: number; ttlMs?: number },
): void {
  const now = options?.now ?? Date.now();
  const ttlMs = options?.ttlMs ?? readDashboardResponseCacheTtlMs();

  cacheEntry = {
    expiresAt: now + ttlMs,
    payload,
  };
}

export function getDashboardResponseInFlight(): Promise<DashboardResponsePayload> | null {
  return inFlightPayload;
}

export function setDashboardResponseInFlight(promise: Promise<DashboardResponsePayload> | null): void {
  inFlightPayload = promise;
}

export function clearDashboardResponseCacheForTests(): void {
  cacheEntry = null;
  inFlightPayload = null;
}
