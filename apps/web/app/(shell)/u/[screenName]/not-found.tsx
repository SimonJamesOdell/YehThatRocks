import Link from "next/link";

import { OverlayHeader } from "@/components/overlay-header";

export default function UserProfileNotFound() {
  return (
    <div className="userProfilePage">
      <OverlayHeader className="userProfileBar" close={false}>
        <strong>User profile unavailable</strong>
        <Link href="/" className="favouritesBlindClose" prefetch={false}>
          Close
        </Link>
      </OverlayHeader>

      <section className="userProfileSection">
        <p className="userProfileEmptyState">This user profile is not available anymore.</p>
      </section>
    </div>
  );
}
