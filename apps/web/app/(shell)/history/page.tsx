import { cookies } from "next/headers";

import { HistoryInfiniteList } from "@/components/history-infinite-list";
import { OverlayHeader } from "@/components/overlay-header";
import { ProtectedAuthGatePanel } from "@/components/protected-auth-gate-panel";
import { REFRESH_TOKEN_COOKIE } from "@/lib/auth-config";
import { getWatchHistory } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";

export default async function HistoryPage() {
  const authState = await getCurrentAuthenticatedUserAuthState();
  const user = authState.status === "authenticated" ? authState.user : null;
  const pageSize = 40;
  const historyWindow = user ? await getWatchHistory(user.id, { limit: pageSize + 1, offset: 0 }) : [];
  const hasMore = historyWindow.length > pageSize;
  const initialHistory = hasMore ? historyWindow.slice(0, pageSize) : historyWindow;

  // Access token may have just expired; if a refresh token exists the client
  // component will silently refresh and reload so the logged-in view appears.
  const cookieStore = await cookies();
  const hasRefreshToken = Boolean(cookieStore.get(REFRESH_TOKEN_COOKIE)?.value);

  return (
    <>
      <OverlayHeader
        icon={<span className="whiteHistoryGlyph" aria-hidden="true">🕘</span>}
        title="History"
      />

      {!user ? (
        <ProtectedAuthGatePanel
            status={authState.status === "unavailable" ? "unavailable" : "unauthenticated"}
          heading="🕘 Watch history"
          headingDetail="Login required"
          unauthenticatedMessage="Sign in to view your watch history."
          hasRefreshToken={hasRefreshToken}
          unavailableMessage={authState.status === "unavailable" ? authState.message : undefined}
        />
      ) : initialHistory.length === 0 ? (
        <section className="accountHistoryPanel historyPagePanel">
          <p className="authMessage">Play a few tracks and your history will appear here.</p>
        </section>
      ) : (
        <HistoryInfiniteList
          initialHistory={initialHistory}
          initialHasMore={hasMore}
          pageSize={pageSize}
          isAuthenticated={Boolean(user)}
        />
      )}
    </>
  );
}
