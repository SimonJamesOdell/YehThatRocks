import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ArtistVideosGridClient } from "@/components/artist-videos-grid-client";
import { getArtistBySlug, getArtistRouteSourceVideoIds, getVideosByArtist } from "@/lib/catalog-data";
import { getShellRequestAuthState, getShellRequestVideoState } from "@/lib/shell-request-state";

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://yehthatrocks.com";

export async function generateMetadata({ params }: ArtistPageProps): Promise<Metadata> {
  const { slug } = await params;
  const artist = await getArtistBySlug(slug);
  if (!artist) return {};
  const title = `${artist.name} Videos | YehThatRocks`;
  const description = `Watch ${artist.name} music videos on YehThatRocks — the home of rock and metal streaming.`;
  const ogImage = artist.thumbnailVideoId
    ? [{ url: `https://i.ytimg.com/vi/${encodeURIComponent(artist.thumbnailVideoId)}/hqdefault.jpg`, width: 480, height: 360, alt: `${artist.name} music video` }]
    : [{ url: `${SITE_ORIGIN}/images/guitar_back.png`, alt: "YehThatRocks" }];
  return {
    title,
    description,
    alternates: { canonical: `/artist/${slug}` },
    openGraph: {
      title,
      description,
      url: `/artist/${slug}`,
      siteName: "YehThatRocks",
      type: "website",
      images: ogImage,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage[0].url],
    },
  };
}

type ArtistPageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type ArtistVideoRow = Awaited<ReturnType<typeof getVideosByArtist>>[number];

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
    artistVideosRaw.map((video: ArtistVideoRow) => video.id),
  );

  const artistVideos = artistVideosRaw
    .filter((video: ArtistVideoRow) => !hiddenVideoIds.has(video.id))
    .map((video: ArtistVideoRow) => {
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
    .filter((video: ArtistVideoRow) => !seenVideoIds.has(video.id))
    .concat(artistVideos.filter((video: ArtistVideoRow) => seenVideoIds.has(video.id)));

  const musicGroupJsonLd = {
    "@context": "https://schema.org",
    "@type": "MusicGroup",
    name: artist.name,
    url: `${SITE_ORIGIN}/artist/${slug}`,
    ...(artist.thumbnailVideoId ? { image: `https://i.ytimg.com/vi/${encodeURIComponent(artist.thumbnailVideoId)}/hqdefault.jpg` } : {}),
    ...(artist.genre ? { genre: artist.genre } : {}),
    ...(artist.country && artist.country !== "Unknown" ? { foundingLocation: { "@type": "Place", name: artist.country } } : {}),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(musicGroupJsonLd) }} />
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
