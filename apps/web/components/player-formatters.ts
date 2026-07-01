export function toSafeNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizePlayerVolume(value: unknown, fallback = 100) {
  return Math.max(0, Math.min(100, Math.round(toSafeNumber(value, fallback))));
}

export function formatPlaybackTime(value: number) {
  const safeValue = Math.max(0, Math.floor(toSafeNumber(value, 0)));
  const hours = Math.floor(safeValue / 3600);
  const minutes = Math.floor((safeValue % 3600) / 60);
  const seconds = safeValue % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function toTitleCaseWords(value: string) {
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}
