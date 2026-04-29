import { redirect } from "next/navigation";

import { ArtistsFilterHeader } from "@/components/artists-filter-header";
import { ArtistsLetterNav } from "@/components/artists-letter-nav";
import { ArtistsLetterResults } from "@/components/artists-letter-results";
import { ArtistsScrollReset } from "@/components/artists-scroll-reset";
import { getArtistsByLetter } from "@/lib/catalog-data";

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
      <ArtistsScrollReset />

      <ArtistsFilterHeader activeLetter={activeLetter} v={v} resume={resume} />

      <ArtistsLetterNav activeLetter={activeLetter} v={v} resume={resume} variant="mobile" />

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
