"use client";

import Link from "next/link";
import type { MouseEvent } from "react";

import {
  normalizeArtistLetter,
} from "@/lib/artists-letter-events";
import { useArtistsLetterContext } from "@/components/artists-letter-provider";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

type ArtistsLetterNavProps = {
  v?: string;
  resume?: string;
  variant?: "panel" | "mobile";
};

export function ArtistsLetterNav({ v, resume, variant = "panel" }: ArtistsLetterNavProps) {
  const { selectedLetter, selectLetter } = useArtistsLetterContext();

  function onLetterClick(event: MouseEvent<HTMLAnchorElement>, letter: string) {
    event.preventDefault();
    const normalized = normalizeArtistLetter(letter);
    selectLetter(normalized);
  }

  const wrapperClassName = variant === "mobile"
    ? "artistAlphabetBar artistAlphabetBarMobileOnly"
    : "artistsLetterPanel";
  const innerClassName = variant === "mobile"
    ? undefined
    : "artistsLetterPanelGrid";

  return (
    <nav className={wrapperClassName} aria-label="Filter artists by first letter">
      <div className={innerClassName}>
        {ALPHABET.map((letter) => {
          const params = new URLSearchParams();
          params.set("letter", letter);
          if (v) params.set("v", v);
          if (resume) params.set("resume", resume);

          const isActive = letter === selectedLetter;
          return (
            <Link
              key={letter}
              href={`/artists?${params.toString()}`}
              className={isActive ? "artistAlphabetButton artistAlphabetButtonActive" : "artistAlphabetButton"}
              onClick={(event) => onLetterClick(event, letter)}
            >
              {letter}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
