import Link from "next/link";

import { CloseLink } from "@/components/close-link";
import { OverlayHeader } from "@/components/overlay-header";

export default function ArtistWikiNotFoundPage() {
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
            <span className="categoryHeaderBreadcrumbCurrent" aria-current="page">Wiki unavailable</span>
          </span>
        </strong>
        <CloseLink />
      </OverlayHeader>

      <section className="artistWikiPage" aria-label="Artist wiki unavailable">
        <article className="artistWikiSection artistWikiOverviewSection">
          <h2>Wiki unavailable</h2>
          <p>We could not find a wiki page for this artist yet.</p>
          <p>
            Try opening another artist, or check back later after more data is available.
          </p>
        </article>
      </section>
    </>
  );
}
