const YOUTUBE_PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;

export function maybeNormalizePlaylistId(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed || !YOUTUBE_PLAYLIST_ID_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}