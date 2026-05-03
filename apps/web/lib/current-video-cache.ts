import type { VideoRecord } from "@/lib/catalog";
import type { CurrentVideoResolveResult } from "@/lib/current-video-route-service";

type CachedVideoRecord = VideoRecord;
type CachedVideoPayload = CurrentVideoResolveResult;

export const currentVideoCache = new Map<string, { expiresAt: number; payload: CachedVideoPayload }>();
export const currentVideoPendingCache = new Map<string, { expiresAt: number; payload: CachedVideoPayload }>();
export const currentVideoInflight = new Map<string, Promise<CachedVideoPayload>>();
export const currentVideoRelatedPoolCache = new Map<string, { expiresAt: number; videos: CachedVideoRecord[] }>();
export const currentVideoRelatedPoolInflight = new Map<string, Promise<CachedVideoRecord[]>>();

export function clearCurrentVideoRouteCaches() {
  currentVideoCache.clear();
  currentVideoPendingCache.clear();
  currentVideoInflight.clear();
  currentVideoRelatedPoolCache.clear();
  currentVideoRelatedPoolInflight.clear();
}
