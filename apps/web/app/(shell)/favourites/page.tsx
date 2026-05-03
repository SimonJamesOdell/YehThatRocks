import { cookies } from "next/headers";

import { FavouritesGrid } from "@/components/favourites-grid";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import { OverlayHeader } from "@/components/overlay-header";
import { ProtectedAuthGatePanel } from "@/components/protected-auth-gate-panel";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/auth-config";
import { getFavouriteVideos } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";

const FAVOURITES_BATCH_SIZE = 20;

export default async function FavouritesPage() {
  const cookieStore = await cookies();
  const hasAccessToken = Boolean(cookieStore.get(ACCESS_TOKEN_COOKIE)?.value);
  const authState = await getCurrentAuthenticatedUserAuthState();
  const user = authState.status === "authenticated" ? authState.user : null;
  const hasRefreshToken = Boolean(cookieStore.get(REFRESH_TOKEN_COOKIE)?.value);
  const favourites = user ? await getFavouriteVideos(user.id) : [];
  const initialFavourites = favourites.slice(0, FAVOURITES_BATCH_SIZE);
  const totalCount = favourites.length;

  return (
    <>
      <OverlayScrollReset />
      {user ? (
        <FavouritesGrid
          initialFavourites={initialFavourites}
          initialTotalCount={totalCount}
          initialHasMore={totalCount > initialFavourites.length}
          isAuthenticated={hasAccessToken}
        />
      ) : (
        <>
          <OverlayHeader
            icon={<span className="whiteHeart" aria-hidden="true">❤</span>}
            title="Favourites"
          />
            <ProtectedAuthGatePanel
              status={authState.status === "unavailable" ? "unavailable" : "unauthenticated"}
            heading="❤ Favourites"
            headingDetail="Login required"
            unauthenticatedMessage="Sign in to view and manage your favourites."
            hasRefreshToken={hasRefreshToken}
            unavailableMessage={authState.status === "unavailable" ? authState.message : undefined}
          />
        </>
      )}
    </>
  );
}
