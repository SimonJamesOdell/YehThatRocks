import type { ReactNode } from "react";
import { ShellDynamic } from "@/components/shell-dynamic";
import { ServiceFailurePanel } from "@/components/service-failure-panel";
import { getCurrentVideo, getDataSourceStatus } from "@/lib/catalog-data";
import { getShellRequestAuthState, getShellRequestVideoState } from "@/lib/shell-request-state";

export const dynamic = "force-dynamic";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const [{ authState, user, isAdmin, hasAccessToken }, initialVideo, dataSourceStatus] = await Promise.all([
    getShellRequestAuthState(),
    getCurrentVideo(),
    getDataSourceStatus(),
  ]);

  if (!initialVideo) {
    const isBackendOutage = dataSourceStatus.mode === "database-error";

    return (
      <ServiceFailurePanel
        mainAriaLabel="Service unavailable"
        panelAriaLabel={isBackendOutage ? "Backend unavailable" : "No approved videos available"}
        eyebrow="Service state"
        title={isBackendOutage ? "Backend unavailable" : "No approved videos available"}
        lead={
          isBackendOutage
            ? "Yeh That Rocks cannot connect to the backend server and cannot load right now. Please try again later."
            : "The backend is online, but there are currently no approved videos to play. Approve videos in Admin to bring the catalog online."
        }
      />
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
    ({ seenVideoIds, hiddenVideoIds } = await getShellRequestVideoState());
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
}

