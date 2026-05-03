import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { ShellDynamic } from "@/components/shell-dynamic";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { getCurrentVideo, getDataSourceStatus, getHiddenVideoIdsForUser, getSeenVideoIdsForUser } from "@/lib/catalog-data";
import { isAdminIdentity } from "@/lib/admin-auth";
import { getCurrentAuthenticatedUserAuthStateByAccessToken } from "@/lib/server-auth";

function renderServiceUnavailablePanel() {
  return (
    <main className="serviceFailureScreen" role="main" aria-label="Service unavailable">
      <div className="serviceFailureBackdrop" aria-hidden="true" />
      <section className="serviceFailurePanel" role="status" aria-live="polite" aria-label="Service unavailable">
        <p className="serviceFailureEyebrow">Service state</p>
        <h2 className="serviceFailureTitle">Service temporarily unavailable</h2>
        <p className="serviceFailureLead">
          The system cannot serve this request right now. Please try again later.
        </p>
        <div className="serviceFailureActions">
          <Link href="/" className="serviceFailureActionSecondary">Back to home</Link>
        </div>
      </section>
    </main>
  );
}

export default async function ShellLayout({ children }: { children: ReactNode }) {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
    const hasAccessToken = Boolean(accessToken);
    const [authState, initialVideo, dataSourceStatus] = await Promise.all([
      getCurrentAuthenticatedUserAuthStateByAccessToken(accessToken),
      getCurrentVideo(),
      getDataSourceStatus(),
    ]);
    const user = authState.status === "authenticated" ? authState.user : null;
    const isAdmin = Boolean(user && isAdminIdentity(user.id, user.email ?? ""));

    if (!initialVideo) {
      const isBackendOutage = dataSourceStatus.mode === "database-error";

      return (
        <main className="serviceFailureScreen" role="main" aria-label="Service unavailable">
          <div className="serviceFailureBackdrop" aria-hidden="true" />
          <section className="serviceFailurePanel" role="status" aria-live="polite" aria-label={isBackendOutage ? "Backend unavailable" : "No approved videos available"}>
            <p className="serviceFailureEyebrow">Service state</p>
            <h2 className="serviceFailureTitle">{isBackendOutage ? "Backend unavailable" : "No approved videos available"}</h2>
            <p className="serviceFailureLead">
              {isBackendOutage
                ? "Yeh That Rocks cannot connect to the backend server and cannot load right now. Please try again later."
                : "The backend is online, but there are currently no approved videos to play. Approve videos in Admin to bring the catalog online."}
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

    let seenVideoIds = new Set<string>();
    let hiddenVideoIds = new Set<string>();
    try {
      [seenVideoIds, hiddenVideoIds] = await Promise.all([
        user ? getSeenVideoIdsForUser(user.id) : Promise.resolve(new Set<string>()),
        user ? getHiddenVideoIdsForUser(user.id) : Promise.resolve(new Set<string>()),
      ]);
    } catch (error) {
      console.error("[shell/layout] user video state preload failed", {
        message: error instanceof Error ? error.message : "unknown error",
        userId: user?.id ?? null,
      });
    }

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
  } catch (error) {
    console.error("[shell/layout] hard-fail", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return renderServiceUnavailablePanel();
  }
}

