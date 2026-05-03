"use client";

import { useCallback, useState } from "react";

import { CloseLink } from "@/components/close-link";
import { OverlayHeader } from "@/components/overlay-header";
import {
  dispatchArtistsFilterChange,
  dispatchArtistsLetterChange,
  isValidArtistLetter,
  normalizeArtistLetter,
} from "@/lib/artists-letter-events";

type ArtistsFilterHeaderProps = {
  activeLetter: string;
  v?: string;
  resume?: string;
};

function updateArtistsLetterInUrl(letter: string, v?: string, resume?: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("letter", letter);

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

export function ArtistsFilterHeader({ activeLetter, v, resume }: ArtistsFilterHeaderProps) {
  const [filterValue, setFilterValue] = useState("");

  const handleFilterChange = useCallback((value: string) => {
    setFilterValue(value);
    dispatchArtistsFilterChange(value);

    const nextLetter = normalizeArtistLetter(value).charAt(0);
    if (!isValidArtistLetter(nextLetter) || nextLetter === activeLetter) {
      return;
    }

    updateArtistsLetterInUrl(nextLetter, v, resume);
    dispatchArtistsLetterChange(nextLetter);
  }, [activeLetter, resume, v]);

  return (
    <OverlayHeader className="categoriesHeaderBar" close={false}>
      <div className="categoriesHeaderMain">
        <strong>
          <span className="categoryHeaderBreadcrumb">🎸 Artists</span>
        </strong>
        <div className="categoriesFilterBar">
          <input
            type="text"
            className="categoriesFilterInput"
            placeholder="type to filter..."
            value={filterValue}
            onChange={(event) => handleFilterChange(event.target.value)}
            aria-label="Filter artists by prefix"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>
      <CloseLink />
    </OverlayHeader>
  );
}
