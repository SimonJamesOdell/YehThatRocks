import type { VideoRecord } from "@/lib/catalog";

export type CurrentVideoResolvePayload = {
  currentVideo?: VideoRecord;
  relatedVideos?: VideoRecord[];
  pending?: boolean;
  pendingReason?: "cooldown" | "concurrency-shed" | "timeout" | "resolver-error";
  retryAfterMs?: number;
  denied?: { message?: string; reason?: string; videoId?: string };
  watchNextAdvisory?: WatchNextAdvisory;
};

export type WatchNextAdvisory = {
  genreFilterActive: boolean;
  genreFilters: string[];
  constrainedByGenreFilter: boolean;
  emptyDueToGenreFilter: boolean;
};

export type LyricsRailPayload = {
  artistName: string | null;
  trackName: string | null;
  lyrics: string | null;
  available: boolean;
  message: string | null;
  source: string | null;
  cached: boolean;
};

export type ShellDynamicProps = {
  initialVideo: VideoRecord;
  initialRelatedVideos: VideoRecord[];
  initialSeenVideoIds?: string[];
  initialHiddenVideoIds?: string[];
  isLoggedIn: boolean;
  initialAuthStatus?: "clear" | "unavailable";
  isAdmin: boolean;
  children: ReactNode;
};

import type { ReactNode } from "react";
