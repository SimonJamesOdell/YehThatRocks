import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { ShellDynamic } from "@/components/shell-dynamic";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { getCurrentVideo, getHiddenVideoIdsForUser, getRelatedVideos, getSeenVideoIdsForUser } from "@/lib/catalog-data";
import { isAdminIdentity } from "@/lib/admin-auth";
import { getCurrentAuthenticatedUserAuthStateByAccessToken } from "@/lib/server-auth";
import { getCachedTopVideos, warmTopVideos } from "@/lib/top-videos-cache";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const hasAccessToken = Boolean(accessToken);
  // Kick off top-video cache warming early so it is ready for padding below
  // and for subsequent API route requests from this server process.
  warmTopVideos(30);
  const [authState, initialVideo] = await Promise.all([
    getCurrentAuthenticatedUserAuthStateByAccessToken(accessToken),
    getCurrentVideo(),
  ]);
  const user = authState.status === "authenticated" ? authState.user : null;
  const isAdmin = Boolean(user && isAdminIdentity(user.id, user.email ?? ""));

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

  const [initialRelatedVideosRaw, seenVideoIds, hiddenVideoIds] = await Promise.all([
    getRelatedVideos(initialVideo.id),
    user ? getSeenVideoIdsForUser(user.id) : Promise.resolve(new Set<string>()),
    user ? getHiddenVideoIdsForUser(user.id) : Promise.resolve(new Set<string>()),
  ]);

  // Opportunistically pad the initial related list to at least 8 entries using
  // cached top videos. This is zero-cost (synchronous cache read) and avoids
  // the Watch Next rail showing only 1 video when the DB returned few results.
  const SSR_MIN_RELATED = 8;
  let initialRelatedVideos = initialRelatedVideosRaw;
  if (initialRelatedVideos.length < SSR_MIN_RELATED) {
    const topPadding = getCachedTopVideos(30) ?? [];
    const blockedIds = new Set([initialVideo.id, ...initialRelatedVideos.map((v) => v.id)]);
    const filler = topPadding
      .filter((v) => !blockedIds.has(v.id))
      .slice(0, SSR_MIN_RELATED - initialRelatedVideos.length);
    if (filler.length > 0) {
      initialRelatedVideos = [...initialRelatedVideos, ...filler];
    }
  }

  return (
    <ShellDynamic
      initialVideo={initialVideo}
      initialRelatedVideos={initialRelatedVideos}
      initialSeenVideoIds={Array.from(seenVideoIds)}
      initialHiddenVideoIds={Array.from(hiddenVideoIds)}
      isLoggedIn={authState.status === "authenticated" || (authState.status === "unavailable" && hasAccessToken)}
      initialAuthStatus={authState.status === "unavailable" ? "unavailable" : "clear"}
      isAdmin={isAdmin}
    >
      {children}
    </ShellDynamic>
  );
}
