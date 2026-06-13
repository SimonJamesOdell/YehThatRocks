import type { VideoRecord } from "@/lib/catalog";
import type { CurrentVideoResolveResult } from "@/lib/current-video-route-service";
import { BoundedMap } from "@/lib/bounded-map";

type CachedVideoRecord = VideoRecord;
type CachedVideoPayload = CurrentVideoResolveResult;

const CURRENT_VIDEO_CACHE_MAX_ENTRIES = 500;

export const currentVideoCache = new BoundedMap<string, { expiresAt: number; payload: CachedVideoPayload }>(CURRENT_VIDEO_CACHE_MAX_ENTRIES);
export const currentVideoPendingCache = new BoundedMap<string, { expiresAt: number; payload: CachedVideoPayload }>(CURRENT_VIDEO_CACHE_MAX_ENTRIES);
export const currentVideoInflight = new BoundedMap<string, Promise<CachedVideoPayload>>(CURRENT_VIDEO_CACHE_MAX_ENTRIES);
export const currentVideoRelatedPoolCache = new BoundedMap<string, { expiresAt: number; videos: CachedVideoRecord[] }>(CURRENT_VIDEO_CACHE_MAX_ENTRIES);
export const currentVideoRelatedPoolInflight = new BoundedMap<string, Promise<CachedVideoRecord[]>>(CURRENT_VIDEO_CACHE_MAX_ENTRIES);

export function clearCurrentVideoRouteCaches() {
  currentVideoCache.clear();
  currentVideoPendingCache.clear();
  currentVideoInflight.clear();
  currentVideoRelatedPoolCache.clear();
  currentVideoRelatedPoolInflight.clear();
}

export function getCurrentVideoCacheDiagnostics() {
  return {
    currentVideoCache: currentVideoCache.size,
    currentVideoPendingCache: currentVideoPendingCache.size,
    currentVideoInflight: currentVideoInflight.size,
    currentVideoRelatedPoolCache: currentVideoRelatedPoolCache.size,
    currentVideoRelatedPoolInflight: currentVideoRelatedPoolInflight.size,
  };
}