/**
 * Centralized typed event contract for all custom window events.
 * Provides type-safe dispatch and listen helpers, with automatic cleanup support.
 */

// ============================================================================
// Event Names (Constants)
// ============================================================================

export const EVENT_NAMES = {
  // Queue and playback
  VIDEO_ENDED: "ytr:video-ended",
  TEMP_QUEUE_DEQUEUE: "ytr:temp-queue-dequeue",
  WATCH_HISTORY_UPDATED: "ytr:watch-history-updated",

  // Playlists
  PLAYLISTS_UPDATED: "ytr:playlists-updated",
  PLAYLIST_CHOOSER_STATE: "ytr:playlist-chooser-state",
  PLAYLIST_RAIL_SYNC: "ytr:playlist-rail-sync",
  PLAYLIST_CREATION_PROGRESS: "ytr:playlist-creation-progress",

  // Right rail and UI
  RIGHT_RAIL_MODE: "ytr:right-rail-mode",
  RIGHT_RAIL_LYRICS_OPEN: "ytr:right-rail-lyrics-open",

  // Navigation and overlay
  OVERLAY_OPEN_REQUEST: "ytr:overlay-open-request",
  OVERLAY_CLOSE_REQUEST: "ytr:overlay-close-request",
  DOCK_HIDE_REQUEST: "ytr:dock-hide-request",
  REQUEST_VIDEO_REPLAY: "ytr:request-video-replay",

  // Admin and catalog
  ADMIN_OVERLAY_ENTER: "ytr:admin-overlay-enter",
  VIDEO_CATALOG_DELETED: "ytr:video-catalog-deleted",
  FAVOURITES_UPDATED: "ytr:favourites-updated",

  // Artists and filtering
  ARTISTS_LETTER_CHANGE: "ytr:artists-letter-change",
  ARTISTS_FILTER_CHANGE: "ytr:artists-filter-change",
} as const;

export type QueueRemovalReason = "ended" | "manual-next" | "transition-sync";

// ============================================================================
// Event Payload Types
// ============================================================================

export type EventPayloads = {
  [EVENT_NAMES.VIDEO_ENDED]: { videoId: string; reason?: QueueRemovalReason };
  [EVENT_NAMES.TEMP_QUEUE_DEQUEUE]: { videoId: string; reason?: QueueRemovalReason };
  [EVENT_NAMES.WATCH_HISTORY_UPDATED]: { videoId: string };
  [EVENT_NAMES.PLAYLISTS_UPDATED]: null;
  [EVENT_NAMES.PLAYLIST_CHOOSER_STATE]: { isOpen: boolean };
  [EVENT_NAMES.PLAYLIST_RAIL_SYNC]: {
    playlist: {
      id: string;
      name: string;
      videos: Array<{ id: string; title: string; channelTitle: string; thumbnail?: string | null }>;
      itemCount: number;
    };
  };
  [EVENT_NAMES.PLAYLIST_CREATION_PROGRESS]: {
    playlistId: string;
    phase: "done" | "failed";
  };
  [EVENT_NAMES.RIGHT_RAIL_MODE]: {
    mode: "watch-next" | "playlist" | "queue";
    playlistId?: string;
    trackId?: string;
  };
  [EVENT_NAMES.RIGHT_RAIL_LYRICS_OPEN]: { videoId: string };
  [EVENT_NAMES.OVERLAY_OPEN_REQUEST]: {
    href: string;
    kind: "wiki" | "video";
  };
  [EVENT_NAMES.OVERLAY_CLOSE_REQUEST]: { href: string };
  [EVENT_NAMES.DOCK_HIDE_REQUEST]: null;
  [EVENT_NAMES.REQUEST_VIDEO_REPLAY]: { videoId: string };
  [EVENT_NAMES.ADMIN_OVERLAY_ENTER]: null;
  [EVENT_NAMES.VIDEO_CATALOG_DELETED]: { videoId: string };
  [EVENT_NAMES.FAVOURITES_UPDATED]: null;
  [EVENT_NAMES.ARTISTS_LETTER_CHANGE]: { letter: string };
  [EVENT_NAMES.ARTISTS_FILTER_CHANGE]: { value: string };
};

// ============================================================================
// Type-safe dispatch helper
// ============================================================================

/**
 * Dispatch a typed custom event with proper payload validation.
 * Usage:
 *   dispatchAppEvent(EVENT_NAMES.VIDEO_ENDED, { videoId: "abc123" });
 *   dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);
 */
export function dispatchAppEvent<K extends keyof EventPayloads>(
  eventName: K,
  payload: EventPayloads[K],
): void {
  if (typeof window === "undefined") {
    return;
  }

  if (payload === null) {
    window.dispatchEvent(new Event(eventName));
  } else {
    window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
  }
}

// ============================================================================
// Type-safe listen helper with automatic cleanup
// ============================================================================

type AppEventListener<K extends keyof EventPayloads> = (payload: EventPayloads[K]) => void;

/**
 * Listen to a typed custom event with automatic cleanup.
 * Returns an unsubscribe function for cleanup.
 * Usage:
 *   const unsubscribe = listenToAppEvent(EVENT_NAMES.VIDEO_ENDED, ({ videoId }) => {
 *     console.log("Video ended:", videoId);
 *   });
 *   // Later...
 *   unsubscribe();
 */
export function listenToAppEvent<K extends keyof EventPayloads>(
  eventName: K,
  handler: AppEventListener<K>,
  options?: AddEventListenerOptions,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const listener = (event: Event) => {
    if (event instanceof CustomEvent) {
      handler(event.detail);
    } else {
      // For events with null payload, pass null
      handler(null as unknown as EventPayloads[K]);
    }
  };

  window.addEventListener(eventName, listener as EventListener);

  return () => {
    window.removeEventListener(eventName, listener as EventListener);
  };
}

// ============================================================================
// Batch listener management helper
// ============================================================================

type UnsubscribeMap = Map<string, () => void>;

/**
 * Create a subscription manager for multiple events with automatic cleanup.
 * Useful for cleaning up all listeners at once (e.g., in useEffect cleanup).
 * Usage:
 *   const subs = createEventSubscriptions();
 *   subs.on(EVENT_NAMES.VIDEO_ENDED, ({ videoId }) => console.log(videoId));
 *   subs.on(EVENT_NAMES.PLAYLISTS_UPDATED, null, () => console.log("updated"));
 *   return () => subs.unsubscribeAll();
 */
export function createEventSubscriptions() {
  const subscriptions: UnsubscribeMap = new Map();

  return {
    on<K extends keyof EventPayloads>(
      eventName: K,
      handler: AppEventListener<K>,
      options?: AddEventListenerOptions,
    ): void {
      const unsub = listenToAppEvent(eventName, handler, options);
      subscriptions.set(eventName, unsub);
    },

    off<K extends keyof EventPayloads>(eventName: K): void {
      const unsub = subscriptions.get(eventName);
      if (unsub) {
        unsub();
        subscriptions.delete(eventName);
      }
    },

    unsubscribeAll(): void {
      subscriptions.forEach((unsub) => unsub());
      subscriptions.clear();
    },

    size(): number {
      return subscriptions.size;
    },
  };
}

// ============================================================================
// Convenience exports for individual event constants
// ============================================================================

// Queue and playback
export const VIDEO_ENDED_EVENT = EVENT_NAMES.VIDEO_ENDED;
export const TEMP_QUEUE_DEQUEUE_EVENT = EVENT_NAMES.TEMP_QUEUE_DEQUEUE;
export const WATCH_HISTORY_UPDATED_EVENT = EVENT_NAMES.WATCH_HISTORY_UPDATED;

// Playlists
export const PLAYLISTS_UPDATED_EVENT = EVENT_NAMES.PLAYLISTS_UPDATED;
export const PLAYLIST_CHOOSER_STATE_EVENT = EVENT_NAMES.PLAYLIST_CHOOSER_STATE;
export const PLAYLIST_RAIL_SYNC_EVENT = EVENT_NAMES.PLAYLIST_RAIL_SYNC;
export const PLAYLIST_CREATION_PROGRESS_EVENT = EVENT_NAMES.PLAYLIST_CREATION_PROGRESS;

// Right rail and UI
export const RIGHT_RAIL_MODE_EVENT = EVENT_NAMES.RIGHT_RAIL_MODE;
export const RIGHT_RAIL_LYRICS_OPEN_EVENT = EVENT_NAMES.RIGHT_RAIL_LYRICS_OPEN;

// Navigation and overlay
export const OVERLAY_OPEN_REQUEST_EVENT = EVENT_NAMES.OVERLAY_OPEN_REQUEST;
export const OVERLAY_CLOSE_REQUEST_EVENT = EVENT_NAMES.OVERLAY_CLOSE_REQUEST;
export const DOCK_HIDE_REQUEST_EVENT = EVENT_NAMES.DOCK_HIDE_REQUEST;
export const REQUEST_VIDEO_REPLAY_EVENT = EVENT_NAMES.REQUEST_VIDEO_REPLAY;

// Admin and catalog
export const ADMIN_OVERLAY_ENTER_EVENT = EVENT_NAMES.ADMIN_OVERLAY_ENTER;
export const VIDEO_CATALOG_DELETED_EVENT = EVENT_NAMES.VIDEO_CATALOG_DELETED;
export const FAVOURITES_UPDATED_EVENT = EVENT_NAMES.FAVOURITES_UPDATED;

// Artists and filtering
export const ARTISTS_LETTER_CHANGE_EVENT = EVENT_NAMES.ARTISTS_LETTER_CHANGE;
export const ARTISTS_FILTER_CHANGE_EVENT = EVENT_NAMES.ARTISTS_FILTER_CHANGE;
