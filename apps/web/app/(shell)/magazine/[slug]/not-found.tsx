import Link from "next/link";
import { CloseLink } from "@/components/close-link";

export default function MagazineArticleNotFound() {
  return (
    <main className="magazinePage" role="main" aria-label="Article not found">
      <div className="favouritesBlindBar magazineOverlayBar">
        <div className="magazineOverlayBarBody">
          <strong className="magazineOverlayBarTitle">Magazine</strong>
        </div>
        <CloseLink />
      </div>

      <section className="magazineNotFoundPanel" role="status" aria-live="polite" aria-label="Article not found">
        <p className="serviceFailureEyebrow">404</p>
        <h2 className="serviceFailureTitle">Article not found</h2>
        <p className="serviceFailureLead">
          This magazine article doesn&apos;t exist or may have been removed.
        </p>
        <div className="serviceFailureActions">
          <Link href="/magazine" className="serviceFailureActionPrimary">
            Back to Magazine
          </Link>
        </div>
      </section>
    </main>
  );
}
