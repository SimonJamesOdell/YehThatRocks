"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

import { CloseLink } from "@/components/close-link";
import { OverlayHeader } from "@/components/overlay-header";
import { withVideoContext } from "@/lib/artist-routing";

function formatArtistFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function ArtistWikiLoading() {
  const params = useParams<{ slug?: string | string[] }>();
  const searchParams = useSearchParams();
  const slugParam = params.slug;
  const slug = Array.isArray(slugParam) ? slugParam[0] : slugParam ?? "";
  const artistLabel = formatArtistFromSlug(slug || "artist");
  const videoId = searchParams.get("v");
  const resume = searchParams.get("resume") === "1";
  const artistHref = withVideoContext(`/artist/${encodeURIComponent(slug)}`, videoId, resume);

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
            <Link href={artistHref} className="categoryHeaderBreadcrumbLink">
              {artistLabel}
            </Link>
            <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
            <span className="categoryHeaderBreadcrumbCurrent" aria-current="page">Wiki</span>
          </span>
        </strong>
        <CloseLink />
      </OverlayHeader>

      <div className="routeContractRow artistLoadingCenter" aria-live="polite" aria-busy="true">
        <span className="playerBootBars" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
        <span>Loading artist wiki...</span>
      </div>
    </>
  );
}
