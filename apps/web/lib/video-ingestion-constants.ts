/**
 * video-ingestion-constants.ts
 * Constants and types for video ingestion, extracted from catalog-data-video-ingestion.ts.
 */

import type { PlaybackDecision } from "@/lib/catalog-data-utils";

// ── Constants ─────────────────────────────────────────────────────────────────

export const AGE_RESTRICTED_PATTERNS = [
  /Sign in to confirm your age/i,
  /age[-\s]?restricted/i,
  /playerAgeGateRenderer/i,
  /desktopLegacyAgeGateReason/i,
  /"isFamilySafe"\s*:\s*false/i,
  /"status"\s*:\s*"AGE_CHECK_REQUIRED"/i,
  /"status"\s*:\s*"LOGIN_REQUIRED"[\s\S]{0,240}"reason"\s*:\s*"[^"]*age/i,
];

export const BOT_CHALLENGE_PATTERNS = [
  /Sign in to (?:confirm|prove) you(?:'|\u2019)re not a bot/i,
  /prove you(?:'|\u2019)re not a bot/i,
  /"status"\s*:\s*"BOT_CHECK_REQUIRED"/i,
];

export const YOUTUBE_DATA_API_KEY = process.env.YOUTUBE_DATA_API_KEY?.trim() || undefined;
export const ENABLE_YOUTUBE_RELATED_DISCOVERY = process.env.ENABLE_YOUTUBE_RELATED_DISCOVERY === "1";
export const ENABLE_AUTOMATED_TRACK_DISCOVERY: boolean = true;
export const AUTOMATED_TRACK_DISCOVERY_DISABLED_REASON = "manual-submissions-only";

export function canRunAutomatedTrackDiscovery(): boolean {
  return ENABLE_AUTOMATED_TRACK_DISCOVERY;
}

export const YOUTUBE_DAILY_QUOTA_UNITS = Math.max(1_000, Number(process.env.YOUTUBE_DAILY_QUOTA_UNITS || "10000"));
export const YOUTUBE_RELATED_DISCOVERY_RESERVED_UNITS = Math.max(0, Number(process.env.YOUTUBE_RELATED_DISCOVERY_RESERVED_UNITS || "2500"));
export const YOUTUBE_RELATED_DISCOVERY_DAILY_BUDGET_UNITS = Math.max(100, Number(process.env.YOUTUBE_RELATED_DISCOVERY_DAILY_BUDGET_UNITS || "3000"));
export const RELATED_DISCOVERY_MAX_DEPTH = Math.max(1, Math.min(4, Number(process.env.RELATED_DISCOVERY_MAX_DEPTH || "2")));
export const RELATED_DISCOVERY_MAX_NEW_VIDEOS = Math.max(1, Math.min(400, Number(process.env.RELATED_DISCOVERY_MAX_NEW_VIDEOS || "16")));
export const RELATED_DISCOVERY_DAILY_NEW_VIDEO_CAP = Math.max(0, Math.min(50, Number(process.env.RELATED_DISCOVERY_DAILY_NEW_VIDEO_CAP || "50")));
export const RELATED_DISCOVERY_SEED_FANOUT = Math.max(1, Math.min(8, Number(process.env.RELATED_DISCOVERY_SEED_FANOUT || "8")));
export const YOUTUBE_RELATED_QUERY_COUNT = Math.max(1, Math.min(5, Number(process.env.YOUTUBE_RELATED_QUERY_COUNT || "3")));
export const YOUTUBE_RELATED_QUERY_MAX_RESULTS = Math.max(6, Math.min(25, Number(process.env.YOUTUBE_RELATED_QUERY_MAX_RESULTS || "14")));
export const YOUTUBE_RELATED_MIN_SCORE = Math.max(0.25, Math.min(3, Number(process.env.YOUTUBE_RELATED_MIN_SCORE || "1.7")));
export const LLM_CLASSIFICATION_MODEL = process.env.LLM_CLASSIFICATION_MODEL?.trim() || "deepseek-v4-flash";
export const LLM_RETRY_COOLDOWN_MS = Math.max(300_000, Number(process.env.LLM_RETRY_COOLDOWN_MS || String(6 * 60 * 60 * 1000)));
export const PLAYBACK_DECISION_CACHE_TTL_MS = 15_000;
export const ALLOWED_VIDEO_TYPES = new Set(["official", "lyric", "live", "cover", "remix", "fan"]);
export const NON_MUSIC_SIGNAL_PATTERN = /\b(instagram|tiktok|facebook|whatsapp|snapchat|podcast|interview|prank|challenge|reaction|vlog|tutorial|gameplay|livestream|stream highlights?|shorts?|sermon|khutbah|tafsir|quran|qur'an|recitation|dua|nasheed|bhajan|kirtan|pravachan|speech|lecture|talk show|news bulletin)\b/i;
export const NON_ROCK_GENRE_PATTERN = /\b(pop|hip\s?hop|rap|r&b|country|edm|techno|house|reggaeton|k\s?pop|j\s?pop|latin pop|afrobeats|trap|dancehall|salsa|bachata|classical|jazz|blues)\b/i;

export const REJECTED_VIDEO_CACHE_TTL_MS = 5 * 60_000;
export const BACKFILL_CONCURRENCY = Math.max(1, Math.min(5, Number(process.env.RELATED_BACKFILL_CONCURRENCY || "2")));
export const INGESTION_CACHE_MAX_ENTRIES = Math.max(
  200,
  Math.min(5_000, Number(process.env.INGESTION_CACHE_MAX_ENTRIES || "1200")),
);

// ── Types ─────────────────────────────────────────────────────────────────────

export type VideoAvailabilityStatus = "available" | "unavailable" | "check-failed";

export type VideoAvailability = {
  status: VideoAvailabilityStatus;
  reason: string;
};

export type YouTubeOEmbedResponse = {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
};

export type YouTubeRelatedSearchResponse = {
  items?: Array<{
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      channelTitle?: string;
      description?: string;
      thumbnails?: {
        high?: { url?: string };
        medium?: { url?: string };
        default?: { url?: string };
      };
    };
  }>;
};

export type CachedPlaybackDecision = {
  expiresAt: number;
  decision: PlaybackDecision;
};

export type ConditionalVideoUpsertFlags = {
  includeChannelTitle: boolean;
  includeGenre: boolean;
};
