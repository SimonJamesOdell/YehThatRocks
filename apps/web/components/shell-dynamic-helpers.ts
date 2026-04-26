/**
 * Pure helper functions extracted from shell-dynamic.tsx for testability and
 * performance-safe memoized-selector re-use.
 *
 * These functions have no React or browser dependencies and can be imported
 * in both the shell component and unit-test files.
 */
import type { VideoRecord } from "@/lib/catalog";

/**
 * Determines whether a transition from `currentIds` to `nextIds` is strictly
 * append-only: no removals, no reorderings — only new items appended at the tail.
 */
export function detectAppendOnly(currentIds: string[], nextIds: string[]): boolean {
  return (
    currentIds.length > 0
    && nextIds.length > currentIds.length
    && currentIds.every((id, index) => nextIds[index] === id)
  );
}

/**
 * Filters the Watch Next rail list based on the user's "hide seen" preference.
 * When both `isAuthenticated` and `watchNextHideSeen` are true, removes videos
 * the user has already seen — unless they are also favourited (favourited > 0).
 *
 * Returns the same array reference when no filtering is applied, so callers
 * wrapped in `useMemo` see a stable reference and skip re-renders.
 */
export function filterSeenFromWatchNext(
  videos: VideoRecord[],
  seenVideoIdSet: Set<string>,
  isAuthenticated: boolean,
  watchNextHideSeen: boolean,
): VideoRecord[] {
  if (!isAuthenticated || !watchNextHideSeen) {
    return videos;
  }
  return videos.filter(
    (video) => !seenVideoIdSet.has(video.id) || Number(video.favourited ?? 0) > 0,
  );
}
