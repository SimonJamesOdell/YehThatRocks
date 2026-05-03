export function isValidArtistLetter(letter: string) {
  return /^[A-Z]$/.test(letter);
}

export function normalizeArtistLetter(letter: string) {
  return letter.trim().toUpperCase();
}

export function normalizeArtistFilterValue(value: string) {
  return value.trim().toLowerCase();
}

export function updateArtistsLetterInUrl(letter: string, v?: string, resume?: string) {
  const normalized = normalizeArtistLetter(letter);
  if (!isValidArtistLetter(normalized)) {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("letter", normalized);

  if (v) {
    url.searchParams.set("v", v);
  } else {
    url.searchParams.delete("v");
  }

  if (resume) {
    url.searchParams.set("resume", resume);
  } else {
    url.searchParams.delete("resume");
  }

  window.history.replaceState(window.history.state, "", `${url.pathname}?${url.searchParams.toString()}`);
}
