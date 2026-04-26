import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { ArtistVideosGridClient } from "@/components/artist-videos-grid-client";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { getArtistBySlug, getHiddenVideoIdsForUser, getNewestVideos, getSeenVideoIdsForUser, getTopVideos, getVideosByArtist } from "@/lib/catalog-data";
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

  const [artistVideosRaw, topVideos, newestVideos] = await Promise.all([
    getVideosByArtist(artist.name),
    getTopVideos(100),
    getNewestVideos(100),
  ]);

  const topVideoIds = new Set(topVideos.map((video) => video.id));
  const newestVideoIds = new Set(newestVideos.map((video) => video.id));
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
