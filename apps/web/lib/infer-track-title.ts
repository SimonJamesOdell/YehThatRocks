/**
 * Extracts the track title from a YouTube-style "Artist - Title" format.
 * Splits on common separators and returns the non-artist portion.
 */
export function inferTrackFromTitle(title: string, artist: string): string {
  const trimmedTitle = title.trim();
  const trimmedArtist = artist.trim();
  if (!trimmedTitle || !trimmedArtist) {
    return trimmedTitle;
  }

  const separators = [" - ", " — ", " | "];
  for (const separator of separators) {
    const split = trimmedTitle.split(separator).map((part) => part.trim()).filter(Boolean);
    if (split.length < 2) {
      continue;
    }

    const [left, right] = split;
    if (left.toLowerCase() === trimmedArtist.toLowerCase()) {
      return right;
    }

    if (right.toLowerCase() === trimmedArtist.toLowerCase()) {
      return left;
    }
  }

  return trimmedTitle;
}
