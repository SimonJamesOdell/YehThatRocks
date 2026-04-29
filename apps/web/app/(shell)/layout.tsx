import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { ShellDynamic } from "@/components/shell-dynamic";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { getCurrentVideo, getHiddenVideoIdsForUser, getSeenVideoIdsForUser } from "@/lib/catalog-data";
import { isAdminIdentity } from "@/lib/admin-auth";
import { getCurrentAuthenticatedUserAuthStateByAccessToken } from "@/lib/server-auth";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const hasAccessToken = Boolean(accessToken);
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

  // isLoggedIn: true for authenticated users and for users with a valid access
  // token during a transient DB outage (trusted pass-through).
  const isLoggedIn =
    authState.status === "authenticated" ||
    (authState.status === "unavailable" && hasAccessToken);

  const [seenVideoIds, hiddenVideoIds] = await Promise.all([
    user ? getSeenVideoIdsForUser(user.id) : Promise.resolve(new Set<string>()),
    user ? getHiddenVideoIdsForUser(user.id) : Promise.resolve(new Set<string>()),
  ]);

  return (
    <ShellDynamic
      initialVideo={initialVideo}
      initialRelatedVideos={[]}
      initialSeenVideoIds={Array.from(seenVideoIds)}
      initialHiddenVideoIds={Array.from(hiddenVideoIds)}
      isLoggedIn={isLoggedIn}
      initialAuthStatus={authState.status === "unavailable" ? "unavailable" : "clear"}
      isAdmin={isAdmin}
    >
      {children}
    </ShellDynamic>
  );
}

