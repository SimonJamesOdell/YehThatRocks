import { notFound } from "next/navigation";

import { ArtistVideosGridClient } from "@/components/artist-videos-grid-client";
import { getArtistBySlug, getArtistRouteSourceVideoIds, getVideosByArtist } from "@/lib/catalog-data";
import { getShellRequestAuthState, getShellRequestVideoState } from "@/lib/shell-request-state";

type ArtistPageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ArtistPage({ params, searchParams }: ArtistPageProps) {
  const [{ hasAccessToken: isAuthenticated }, { seenVideoIds, hiddenVideoIds }] = await Promise.all([
    getShellRequestAuthState(),
    getShellRequestVideoState(),
  ]);
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

  const artistVideosRaw = await getVideosByArtist(artist.name);
  const { topVideoIds, newestVideoIds } = await getArtistRouteSourceVideoIds(
    artistVideosRaw.map((video) => video.id),
  );

  const artistVideos = artistVideosRaw
    .filter((video) => !hiddenVideoIds.has(video.id))
    .map((video) => {
      const isTop100Source = topVideoIds.has(video.id);
      const isNewSource = newestVideoIds.has(video.id);
      const sourceLabel: "Top100" | "New" | undefined = isTop100Source ? "Top100" : isNewSource ? "New" : undefined;

      return {
        ...video,
        isTop100Source,
        isNewSource,
        sourceLabel,
      };
    });
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
