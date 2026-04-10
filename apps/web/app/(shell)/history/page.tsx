import { cookies } from "next/headers";
import Link from "next/link";

import { AuthRefreshReload } from "@/components/auth-refresh-reload";
import { CloseLink } from "@/components/close-link";
import { HistoryInfiniteList } from "@/components/history-infinite-list";
import { REFRESH_TOKEN_COOKIE } from "@/lib/auth-config";
import { getWatchHistory } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";

export default async function HistoryPage() {
  const user = await getCurrentAuthenticatedUser();
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
      <div className="favouritesBlindBar">
        <strong><span className="whiteHistoryGlyph" aria-hidden="true">🕘</span> History</strong>
        <CloseLink />
      </div>

      {!user ? (
        <section className="panel featurePanel">
          {hasRefreshToken && <AuthRefreshReload />}
          <div className="panelHeading">
            <span><span className="whiteHistoryGlyph" aria-hidden="true">🕘</span> Watch history</span>
            <strong>Login required</strong>
          </div>
          <div className="interactiveStack">
            <p className="authMessage">Sign in to view your watch history.</p>
            <div className="primaryActions compactActions">
              <Link href="/login" className="navLink navLinkActive">Login</Link>
              <Link href="/register" className="navLink">Register</Link>
            </div>
          </div>
        </section>
      ) : initialHistory.length === 0 ? (
        <section className="accountHistoryPanel historyPagePanel">
          <p className="authMessage">Play a few tracks and your history will appear here.</p>
        </section>
      ) : (
        <HistoryInfiniteList initialHistory={initialHistory} initialHasMore={hasMore} pageSize={pageSize} />
      )}
    </>
  );
}
