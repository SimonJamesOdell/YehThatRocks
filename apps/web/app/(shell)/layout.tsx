import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { ShellDynamic } from "@/components/shell-dynamic";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { getCurrentVideo, getRelatedVideos } from "@/lib/catalog-data";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const hasAccessToken = Boolean(cookieStore.get(ACCESS_TOKEN_COOKIE)?.value);
  const initialVideo = await getCurrentVideo();

  if (!initialVideo) {
    return (
      <main className="serviceFailureScreen" role="main" aria-label="Service unavailable">
        <div className="serviceFailureBackdrop" aria-hidden="true" />
        <section className="serviceFailurePanel" role="status" aria-live="polite" aria-label="Backend unavailable">
          <p className="serviceFailureEyebrow">Service state</p>
          <h2 className="serviceFailureTitle">Backend unavailable</h2>
          <p className="serviceFailureLead">
            Yeh That Rocks cannot connect to the backend server and cannot load right now. Please try again later.
          </p>

        </section>
      </main>
    );
  }

  const initialRelatedVideos = await getRelatedVideos(initialVideo.id);

  return (
    <ShellDynamic
      initialVideo={initialVideo}
      initialRelatedVideos={initialRelatedVideos}
      isLoggedIn={hasAccessToken}
    >
      {children}
    </ShellDynamic>
  );
}
