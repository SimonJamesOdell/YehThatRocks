import type { VideoRecord } from "@/lib/catalog";

type CachedVideoRecord = VideoRecord;

export const currentVideoCache = new Map<string, { expiresAt: number; payload: any }>();
export const currentVideoPendingCache = new Map<string, { expiresAt: number; payload: any }>();
export const currentVideoInflight = new Map<string, Promise<any>>();
export const currentVideoRelatedPoolCache = new Map<string, { expiresAt: number; videos: CachedVideoRecord[] }>();
export const currentVideoRelatedPoolInflight = new Map<string, Promise<CachedVideoRecord[]>>();

export function clearCurrentVideoRouteCaches() {
  currentVideoCache.clear();
  currentVideoPendingCache.clear();
  currentVideoInflight.clear();
  currentVideoRelatedPoolCache.clear();
  currentVideoRelatedPoolInflight.clear();
}
