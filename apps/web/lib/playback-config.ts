export const PLAYBACK_MIN_CONFIDENCE = Math.max(
  0,
  Math.min(1, Number(process.env.PLAYBACK_MIN_CONFIDENCE || "0.8")),
);