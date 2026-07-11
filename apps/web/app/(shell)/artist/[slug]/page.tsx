import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ArtistVideosGridClient } from "@/components/artist-videos-grid-client";
import { getArtistBySlug, getArtistRouteSourceVideoIds, getStoredVideoById, getVideosByArtist, mapVideo, slugify } from "@/lib/catalog-data";
import { getShellRequestAuthState, getShellRequestVideoState } from "@/lib/shell-request-state";
import {
  buildVideoObject,
  buildMusicRecording,
  buildBreadcrumbList,
  buildMusicGroup,
  buildOgImageUrl,
} from "@/lib/schema-org";

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://yehthatrocks.com";

export async function generateMetadata({ params }: ArtistPageProps): Promise<Metadata> {
  const { slug } = await params;
  const artist = await getArtistBySlug(slug);
  if (!artist) return {};
  const title = `${artist.name} Videos | YehThatRocks`;
  const description = `Watch ${artist.name} music videos on YehThatRocks — the home of rock and metal streaming.`;
  const ogImageUrl = buildOgImageUrl({ type: "artist", name: artist.name, genre: artist.genre || "" });
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
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: `${artist.name} music videos on YehThatRocks` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

type ArtistPageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type ArtistVideoRow = Awaited<ReturnType<typeof getVideosByArtist>>[number];

export default async function ArtistPage({ params, searchParams }: ArtistPageProps) {
  const [{ hasAccessToken: isAuthenticated, isAdmin }, { seenVideoIds, hiddenVideoIds }] = await Promise.all([
    getShellRequestAuthState(),
    getShellRequestVideoState(),
  ]);
  const { slug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const letter = typeof resolvedSearchParams?.letter === "string" ? resolvedSearchParams.letter : undefined;
  const v = typeof resolvedSearchParams?.v === "string" ? resolvedSearchParams.v : undefined;
  const resume = typeof resolvedSearchParams?.resume === "string" ? resolvedSearchParams.resume : undefined;
  const contextVideoId = (v ?? "").trim();
  let artist = await getArtistBySlug(slug);

  if (!artist && contextVideoId) {
    const contextStored = await getStoredVideoById(contextVideoId, { includeUnapproved: true });
    const contextArtist = (contextStored?.parsedArtist ?? contextStored?.channelTitle ?? "").trim();
    if (contextArtist && slugify(contextArtist) === slug) {
      artist = {
        name: contextArtist,
        slug,
        country: "Unknown",
        genre: "Rock / Metal",
        thumbnailVideoId: contextVideoId,
      };
    }
  }

  if (!artist) {
    notFound();
  }

  const artistsParams = new URLSearchParams();
  if (letter) artistsParams.set("letter", letter);
  if (v) artistsParams.set("v", v);
  if (resume) artistsParams.set("resume", resume);
  const artistsHref = artistsParams.toString() ? `/artists?${artistsParams.toString()}` : "/artists";

  let artistVideosRaw = await getVideosByArtist(artist.name);
  if (contextVideoId && !artistVideosRaw.some((video: ArtistVideoRow) => video.id === contextVideoId)) {
    const contextStored = await getStoredVideoById(contextVideoId, { includeUnapproved: true });
    const contextArtist = (contextStored?.parsedArtist ?? contextStored?.channelTitle ?? "").trim();
    if (contextStored && contextArtist) {
      const contextSlug = slugify(contextArtist);
      if (contextSlug === slug || contextSlug.startsWith(`${slug}-`)) {
        artistVideosRaw = [mapVideo(contextStored), ...artistVideosRaw];
      }
    }
  }

  const { topVideoIds, newestVideoIds } = await getArtistRouteSourceVideoIds(
    artistVideosRaw.map((video: ArtistVideoRow) => video.id),
  );

  const artistVideos = artistVideosRaw
    .filter((video: ArtistVideoRow) => !hiddenVideoIds.has(video.id) || (contextVideoId.length > 0 && video.id === contextVideoId))
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

  // ── Schema.org structured data ──────────────────────────────────────────
  const musicGroupJsonLd = buildMusicGroup({
    artistName: artist.name,
    slug,
    genre: artist.genre,
    country: artist.country,
    thumbnailVideoId: artist.thumbnailVideoId,
  });

  const breadcrumbJsonLd = contextVideoId && artist
    ? buildBreadcrumbList([
        { name: "Home", url: SITE_ORIGIN },
        { name: artist.name, url: `${SITE_ORIGIN}/artist/${encodeURIComponent(slug)}` },
        { name: contextVideoId, url: `${SITE_ORIGIN}/artist/${encodeURIComponent(slug)}?v=${encodeURIComponent(contextVideoId)}` },
      ])
    : buildBreadcrumbList([
        { name: "Home", url: SITE_ORIGIN },
        { name: artist.name, url: `${SITE_ORIGIN}/artist/${encodeURIComponent(slug)}` },
      ]);

  // VideoObject for the context video if present
  const contextVideo = contextVideoId
    ? await getStoredVideoById(contextVideoId, { includeUnapproved: true })
    : null;
  const videoJsonLd = contextVideo && contextVideo.videoId
    ? buildVideoObject({
        videoId: contextVideo.videoId,
        title: contextVideo.title,
        description: contextVideo.description,
        artist: contextVideo.parsedArtist || contextVideo.channelTitle,
        trackName: contextVideo.parsedTrack,
        genre: contextVideo.genre ?? artist.genre,
      })
    : null;

  const musicRecordingJsonLd = contextVideo && contextVideo.videoId && contextVideo.parsedTrack
    ? buildMusicRecording({
        trackName: contextVideo.parsedTrack,
        artistName: contextVideo.parsedArtist || contextVideo.channelTitle || artist.name,
        genre: contextVideo.genre ?? artist.genre,
        url: `${SITE_ORIGIN}/artist/${encodeURIComponent(slug)}?v=${encodeURIComponent(contextVideo.videoId)}`,
        videoId: contextVideo.videoId,
      })
    : null;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(musicGroupJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      {videoJsonLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(videoJsonLd) }} />
      ) : null}
      {musicRecordingJsonLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(musicRecordingJsonLd) }} />
      ) : null}
      <ArtistVideosGridClient
        artistName={artist.name}
        artistSlug={slug}
        artistsHref={artistsHref}
        initialVideos={orderedArtistVideos}
        seenVideoIds={Array.from(seenVideoIds)}
        isAuthenticated={isAuthenticated}
        isAdmin={isAdmin}
      />
    </>
  );
}
