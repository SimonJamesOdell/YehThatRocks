import { cookies } from "next/headers";

import { FavouritesHeaderControls } from "@/components/favourites-header-controls";
import { FavouritesGrid } from "@/components/favourites-grid";
import { OverlayProtectedRouteLayout } from "@/components/overlay-protected-route-layout";
import { REFRESH_TOKEN_COOKIE } from "@/lib/auth-config";
import { getFavouriteVideos } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";

const FAVOURITES_BATCH_SIZE = 20;

export default async function FavouritesPage() {
  const cookieStore = await cookies();
  const authState = await getCurrentAuthenticatedUserAuthState();
  const user = authState.status === "authenticated" ? authState.user : null;
  const hasRefreshToken = Boolean(cookieStore.get(REFRESH_TOKEN_COOKIE)?.value);
  const favourites = user ? await getFavouriteVideos(user.id) : [];
  const initialFavourites = favourites.slice(0, FAVOURITES_BATCH_SIZE);
  const totalCount = favourites.length;

  return (
    <OverlayProtectedRouteLayout
      authStatus={authState.status}
      authMessage={authState.status === "unavailable" ? authState.message : undefined}
      hasRefreshToken={hasRefreshToken}
      headerProps={{
        children: (
          <div className="favouritesPageHeaderContent">
            <strong className="favouritesPageHeaderTitle">
              <span className="whiteHeart favouritesPageHeart" aria-hidden="true">❤</span>
              Favourites <span className="favouritesPageHeaderCount">({totalCount})</span>
            </strong>
            <FavouritesHeaderControls isAuthenticated={Boolean(user)} />
          </div>
        ),
      }}
      gateHeading="❤ Favourites"
      gateHeadingDetail="Login required"
      gateMessage="Sign in to view and manage your favourites."
    >
      <FavouritesGrid
        initialFavourites={initialFavourites}
        initialTotalCount={totalCount}
        initialHasMore={totalCount > initialFavourites.length}
        isAuthenticated={Boolean(user)}
      />
    </OverlayProtectedRouteLayout>
  );
}
