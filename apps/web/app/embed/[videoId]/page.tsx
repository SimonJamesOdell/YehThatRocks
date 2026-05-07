import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { normalizeYouTubeVideoId } from "@/lib/catalog-data";
import { prisma } from "@/lib/db";
import { EmbedPlayer } from "@/components/embed-player";

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://yehthatrocks.com";

type EmbedPageProps = {
  params: Promise<{ videoId: string }>;
};

async function resolveVideoMeta(normalizedId: string) {
  try {
    return await prisma.video.findUnique({
      where: { videoId: normalizedId },
      select: { title: true, parsedArtist: true, parsedTrack: true },
    });
  } catch {
    return null;
  }
}

function buildDisplayTitle(video: { title: string; parsedArtist: string | null; parsedTrack: string | null } | null) {
  if (!video) return "";
  if (video.parsedArtist && video.parsedTrack) {
    return `${video.parsedArtist} — ${video.parsedTrack}`;
  }
  return video.title;
}

export async function generateMetadata({ params }: EmbedPageProps): Promise<Metadata> {
  const { videoId } = await params;
  const normalizedId = normalizeYouTubeVideoId(videoId);
  if (!normalizedId) return { title: "YehThatRocks" };

  const video = await resolveVideoMeta(normalizedId);
  const displayTitle = buildDisplayTitle(video);
  const pageTitle = displayTitle ? `${displayTitle} | YehThatRocks` : "YehThatRocks";

  return {
    title: pageTitle,
    robots: { index: false, follow: false },
  };
}

export default async function EmbedPage({ params }: EmbedPageProps) {
  const { videoId } = await params;
  const normalizedId = normalizeYouTubeVideoId(videoId);

  if (!normalizedId) {
    notFound();
  }

  const video = await resolveVideoMeta(normalizedId);
  const displayTitle = buildDisplayTitle(video);
  const watchUrl = `${SITE_ORIGIN}/?v=${encodeURIComponent(normalizedId)}`;

  return (
    <EmbedPlayer
      videoId={normalizedId}
      title={displayTitle}
      watchUrl={watchUrl}
    />
  );
}
