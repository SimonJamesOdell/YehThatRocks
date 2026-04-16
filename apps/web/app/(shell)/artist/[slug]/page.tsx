import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { ArtistVideosGridClient } from "@/components/artist-videos-grid-client";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { getArtistBySlug, getHiddenVideoIdsForUser, getSeenVideoIdsForUser, getVideosByArtist } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";

type ArtistPageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ArtistPage({ params, searchParams }: ArtistPageProps) {
  const cookieStore = await cookies();
  const isAuthenticated = Boolean(cookieStore.get(ACCESS_TOKEN_COOKIE)?.value);
  const user = await getCurrentAuthenticatedUser();
  const seenVideoIds = user ? await getSeenVideoIdsForUser(user.id) : new Set<string>();
  const hiddenVideoIds = user ? await getHiddenVideoIdsForUser(user.id) : new Set<string>();
  const { slug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const letter = typeof resolvedSearchParams?.letter === "string" ? resolvedSearchParams.letter : undefined;
  const v = typeof resolvedSearchParams?.v === "string" ? resolvedSearchParams.v : undefined;
  const resume = typeof resolvedSearchParams?.resume === "string" ? resolvedSearchParams.resume : undefined;
  const artist = await getArtistBySlug(slug);

  if (!artist) {
    notFound();
  }

  const artistsParams = new URLSearchParams();
  if (letter) artistsParams.set("letter", letter);
  if (v) artistsParams.set("v", v);
  if (resume) artistsParams.set("resume", resume);
  const artistsHref = artistsParams.toString() ? `/artists?${artistsParams.toString()}` : "/artists";

  const artistVideos = (await getVideosByArtist(artist.name)).filter((video) => !hiddenVideoIds.has(video.id));
  const orderedArtistVideos = artistVideos
    .filter((video) => !seenVideoIds.has(video.id))
    .concat(artistVideos.filter((video) => seenVideoIds.has(video.id)));

  return (
    <>
      <ArtistVideosGridClient
        artistName={artist.name}
        artistsHref={artistsHref}
        initialVideos={orderedArtistVideos}
        seenVideoIds={Array.from(seenVideoIds)}
        isAuthenticated={isAuthenticated}
      />
    </>
  );
}
