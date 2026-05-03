"use client";

import { useCallback } from "react";

import { CloseLink } from "@/components/close-link";
import { OverlayHeader } from "@/components/overlay-header";
import { useArtistsLetterContext } from "@/components/artists-letter-provider";
import {
  isValidArtistLetter,
  normalizeArtistLetter,
} from "@/lib/artists-letter-events";

export function ArtistsFilterHeader() {
  const { filterValue, selectedLetter, selectLetter, setFilterValue } = useArtistsLetterContext();

  const handleFilterChange = useCallback((value: string) => {
    setFilterValue(value);

    const nextLetter = normalizeArtistLetter(value).charAt(0);
    if (!isValidArtistLetter(nextLetter) || nextLetter === selectedLetter) {
      return;
    }

    selectLetter(nextLetter);
  }, [selectLetter, selectedLetter, setFilterValue]);

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
