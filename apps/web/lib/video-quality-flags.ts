export const VIDEO_QUALITY_FLAG_REASONS = [
  "broken-playback",
  "non-music",
  "misleading-title",
  "poor-audio",
  "low-effort-reupload",
] as const;

export type VideoQualityFlagReason = (typeof VIDEO_QUALITY_FLAG_REASONS)[number];

export const VIDEO_QUALITY_FLAG_REASON_LABELS: Record<VideoQualityFlagReason, string> = {
  "broken-playback": "Broken playback",
  "non-music": "Not music",
  "misleading-title": "Misleading title or metadata",
  "poor-audio": "Poor audio quality",
  "low-effort-reupload": "Low-quality reupload",
};

export const VIDEO_QUALITY_FLAG_MIN_USERS_FOR_ACTION = 3;
export const VIDEO_QUALITY_FLAG_MIN_CONFIDENCE = 0.7;
