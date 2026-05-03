import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ArtistsFilterHeader } from "@/components/artists-filter-header";
import { ArtistsLetterNav } from "@/components/artists-letter-nav";
import { ArtistsLetterResults } from "@/components/artists-letter-results";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import { getArtistsByLetter } from "@/lib/catalog-data";

export const metadata: Metadata = {
  title: "Rock & Metal Artists A–Z | YehThatRocks",
  description: "Browse over 140,000 rock and metal artists on YehThatRocks. Find your favourite band and watch their videos.",
  alternates: { canonical: "/artists" },
  openGraph: {
    title: "Rock & Metal Artists A–Z | YehThatRocks",
    description: "Browse over 140,000 rock and metal artists on YehThatRocks.",
    url: "/artists",
    siteName: "YehThatRocks",
    type: "website",
  },
};

type ArtistsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const ARTISTS_PAGE_CHUNK = 60;

export default async function ArtistsPage({ searchParams }: ArtistsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedLetterRaw = typeof resolvedSearchParams?.letter === "string" ? resolvedSearchParams.letter : undefined;
  const v = typeof resolvedSearchParams?.v === "string" ? resolvedSearchParams.v : undefined;
  const resume = typeof resolvedSearchParams?.resume === "string" ? resolvedSearchParams.resume : undefined;

  if (!requestedLetterRaw || !ALPHABET.includes(requestedLetterRaw.trim().toUpperCase())) {
    const params = new URLSearchParams();
    params.set("letter", "A");
    if (v) params.set("v", v);
    if (resume) params.set("resume", resume);
    redirect(`/artists?${params.toString()}`);
  }

  const requestedLetter = requestedLetterRaw.trim().toUpperCase();
  const activeLetter = requestedLetter;
  const initialArtists = await getArtistsByLetter(activeLetter, ARTISTS_PAGE_CHUNK + 1, 0);
  const initialHasMore = initialArtists.length > ARTISTS_PAGE_CHUNK;
  const initialChunk = initialHasMore ? initialArtists.slice(0, ARTISTS_PAGE_CHUNK) : initialArtists;

  return (
    <>
      <OverlayScrollReset />

      <ArtistsFilterHeader />

      <ArtistsLetterNav v={v} resume={resume} variant="mobile" />

      <ArtistsLetterResults
        letter={activeLetter}
        initialArtists={initialChunk}
        initialHasMore={initialHasMore}
        pageSize={ARTISTS_PAGE_CHUNK}
        v={v}
        resume={resume}
      />
    </>
  );
}
