"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  isValidArtistLetter,
  normalizeArtistLetter,
  updateArtistsLetterInUrl,
} from "@/lib/artists-letter-events";

type ArtistsLetterContextValue = {
  selectedLetter: string;
  filterValue: string;
  setFilterValue: (value: string) => void;
  selectLetter: (letter: string) => boolean;
};

type ArtistsLetterProviderProps = {
  initialLetter: string;
  v?: string;
  resume?: string;
  children: ReactNode;
};

const ArtistsLetterContext = createContext<ArtistsLetterContextValue | null>(null);

function normalizeOrDefault(letter: string) {
  const normalized = normalizeArtistLetter(letter);
  return isValidArtistLetter(normalized) ? normalized : "A";
}

export function ArtistsLetterProvider({ initialLetter, v, resume, children }: ArtistsLetterProviderProps) {
  const [selectedLetter, setSelectedLetter] = useState(() => normalizeOrDefault(initialLetter));
  const [filterValue, setFilterValue] = useState("");

  useEffect(() => {
    setSelectedLetter(normalizeOrDefault(initialLetter));
  }, [initialLetter]);

  const selectLetter = useCallback((letter: string) => {
    const normalized = normalizeArtistLetter(letter);
    if (!isValidArtistLetter(normalized) || normalized === selectedLetter) {
      return false;
    }

    setSelectedLetter(normalized);
    updateArtistsLetterInUrl(normalized, v, resume);
    return true;
  }, [resume, selectedLetter, v]);

  const contextValue = useMemo<ArtistsLetterContextValue>(() => ({
    selectedLetter,
    filterValue,
    setFilterValue,
    selectLetter,
  }), [filterValue, selectLetter, selectedLetter]);

  return (
    <ArtistsLetterContext.Provider value={contextValue}>
      {children}
    </ArtistsLetterContext.Provider>
  );
}

export function useArtistsLetterContext() {
  const context = useContext(ArtistsLetterContext);
  if (!context) {
    throw new Error("useArtistsLetterContext must be used within ArtistsLetterProvider");
  }

  return context;
}
