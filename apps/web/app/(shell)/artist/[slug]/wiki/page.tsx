import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CloseLink } from "@/components/close-link";
import { OverlayHeader } from "@/components/overlay-header";
import { WikiContentClient } from "@/components/wiki-content-client";
import { getArtistBySlug, upsertVerifiedExternalArtistCandidate } from "@/lib/catalog-data";
import { getCachedWikiOnly, isWikiGenerationEnabled } from "@/lib/artist-wiki";
import { verifyExternalArtistBySlug } from "@/lib/artist-wiki";
import { getArtistPagePath, withVideoContext } from "@/lib/artist-routing";

type ArtistWikiPageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: ArtistWikiPageProps): Promise<Metadata> {
  const { slug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const videoId = typeof resolvedSearchParams?.v === "string" ? resolvedSearchParams.v : undefined;

  const artist = await getArtistBySlug(slug);

  if (!artist) {
    // Still return a basic metadata frame for pages not yet in the catalog
    const derivedName = slug
      .split("-")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ");
    return {
      title: `${derivedName} — Artist Wiki | YehThatRocks`,
      description: `Learn about ${derivedName} — biography, discography, members, and more on YehThatRocks.`,
      openGraph: {
        title: `${derivedName} — Artist Wiki | YehThatRocks`,
        description: `Learn about ${derivedName} — biography, discography, members, and more.`,
        type: "article",
      },
    };
  }

  const wiki = await getCachedWikiOnly(artist.name, slug);

  return {
    title: `${artist.name} — Artist Wiki | YehThatRocks`,
    description: wiki?.sections.overview
      ? wiki.sections.overview.slice(0, 160)
      : `Artist wiki for ${artist.name} — biography, discography, members, and more on YehThatRocks.`,
    openGraph: {
      title: `${artist.name} — Artist Wiki | YehThatRocks`,
      description: wiki?.sections.overview?.slice(0, 200)
        || `Artist wiki for ${artist.name} on YehThatRocks.`,
      type: "article",
      images: wiki?.images?.[0]?.url ? [{ url: wiki.images[0].url }] : undefined,
    },
  };
}

export default async function ArtistWikiPage({ params, searchParams }: ArtistWikiPageProps) {
  const { slug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const videoId = typeof resolvedSearchParams?.v === "string" ? resolvedSearchParams.v : undefined;
  const resume = typeof resolvedSearchParams?.resume === "string" ? resolvedSearchParams.resume : undefined;

  let artist = await getArtistBySlug(slug);

  if (!artist) {
    const verifiedExternal = await verifyExternalArtistBySlug(slug);
    if (verifiedExternal) {
      await upsertVerifiedExternalArtistCandidate({
        name: verifiedExternal.artistName,
        country: verifiedExternal.country,
        genre: verifiedExternal.genre,
        thumbnailVideoId: videoId,
      });
      artist = await getArtistBySlug(slug);
    }
  }

  if (!artist) {
    notFound();
  }

  // Server-side cache check (fast, no generation)
  const cachedWiki = await getCachedWikiOnly(artist.name, slug);
  const generationEnabled = isWikiGenerationEnabled();
  const artistPagePath = getArtistPagePath(artist.name);
  const artistPageHref = artistPagePath ? withVideoContext(artistPagePath, videoId, resume === "1") : "/artists";

  return (
    <>
      <OverlayHeader close={false}>
        <strong>
          <span className="categoryHeaderBreadcrumb" aria-label="Breadcrumb">
            <span className="categoryHeaderIcon" aria-hidden="true">📖</span>
            <Link href="/artists" className="categoryHeaderBreadcrumbLink">
              Artists
            </Link>
            <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
            <Link href={artistPageHref} className="categoryHeaderBreadcrumbLink">
              {artist.name}
            </Link>
            <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
            <span className="categoryHeaderBreadcrumbCurrent" aria-current="page">Wiki</span>
          </span>
        </strong>
        <CloseLink />
      </OverlayHeader>

      <Suspense
        fallback={
          <div className="routeContractRow artistLoadingCenter" aria-live="polite" aria-busy="true">
            <span className="playerBootBars" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </span>
            <span>Loading artist wiki...</span>
          </div>
        }
      >
        <WikiContentClient
          artistName={artist.name}
          slug={slug}
          cachedWiki={cachedWiki}
          generationEnabled={generationEnabled}
        />
      </Suspense>
    </>
  );
}
