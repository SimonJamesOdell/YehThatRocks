import Link from "next/link";
import { CloseLink } from "@/components/close-link";
import { OverlayHeader } from "@/components/overlay-header";

export default function MagazineArticleNotFound() {
  return (
    <main className="magazinePage" role="main" aria-label="Article not found">
      <OverlayHeader className="magazineOverlayBar" close={false}>
        <div className="magazineOverlayBarBody">
          <strong className="magazineOverlayBarTitle">Magazine</strong>
        </div>
        <CloseLink />
      </OverlayHeader>

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
