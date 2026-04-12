export const ARTISTS_LETTER_CHANGE_EVENT = "ytr:artists-letter-change";
export const ARTISTS_FILTER_CHANGE_EVENT = "ytr:artists-filter-change";

export type ArtistsLetterChangeDetail = {
  letter: string;
};

export type ArtistsFilterChangeDetail = {
  value: string;
};

export function isValidArtistLetter(letter: string) {
  return /^[A-Z]$/.test(letter);
}

export function normalizeArtistLetter(letter: string) {
  return letter.trim().toUpperCase();
}

export function normalizeArtistFilterValue(value: string) {
  return value.trim().toLowerCase();
}

export function dispatchArtistsLetterChange(letter: string) {
  const normalized = normalizeArtistLetter(letter);
  if (!isValidArtistLetter(normalized)) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<ArtistsLetterChangeDetail>(ARTISTS_LETTER_CHANGE_EVENT, {
      detail: { letter: normalized },
    }),
  );
}

export function dispatchArtistsFilterChange(value: string) {
  window.dispatchEvent(
    new CustomEvent<ArtistsFilterChangeDetail>(ARTISTS_FILTER_CHANGE_EVENT, {
      detail: { value },
    }),
  );
}
