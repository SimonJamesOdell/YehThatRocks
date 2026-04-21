import { cookies } from "next/headers";

import { CloseLink } from "@/components/close-link";
import { PlaylistsGrid } from "@/components/playlists-grid";
import { ProtectedAuthGatePanel } from "@/components/protected-auth-gate-panel";
import { REFRESH_TOKEN_COOKIE } from "@/lib/auth-config";
import { getPlaylists } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";

export default async function PlaylistsPage() {
  const cookieStore = await cookies();
  const authState = await getCurrentAuthenticatedUserAuthState();
  const user = authState.status === "authenticated" ? authState.user : null;
  const hasRefreshToken = Boolean(cookieStore.get(REFRESH_TOKEN_COOKIE)?.value);
  const playlists = await getPlaylists(user?.id);

  if (!user) {
    return (
      <>
        <div className="favouritesBlindBar">
          <strong><span className="whitePlaylistGlyph" aria-hidden="true">♬</span> Playlists</strong>
          <CloseLink />
        </div>
            <ProtectedAuthGatePanel
              status={authState.status === "unavailable" ? "unavailable" : "unauthenticated"}
          heading="♬ Playlists"
          headingDetail="Login required"
          unauthenticatedMessage="Sign in to manage saved playlists."
          hasRefreshToken={hasRefreshToken}
          unavailableMessage={authState.status === "unavailable" ? authState.message : undefined}
        />
      </>
    );
  }

  return (
    <PlaylistsGrid initialPlaylists={playlists} isAuthenticated={true} />
  );
}
