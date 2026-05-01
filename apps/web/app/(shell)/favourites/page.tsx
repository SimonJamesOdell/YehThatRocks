import { cookies } from "next/headers";

import { CloseLink } from "@/components/close-link";
import { FavouritesGrid } from "@/components/favourites-grid";
import { FavouritesScrollReset } from "@/components/favourites-scroll-reset";
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
      <FavouritesScrollReset />
      {user ? (
        <FavouritesGrid
          initialFavourites={initialFavourites}
          initialTotalCount={totalCount}
          initialHasMore={totalCount > initialFavourites.length}
          isAuthenticated={hasAccessToken}
        />
      ) : (
        <>
          <div className="favouritesBlindBar">
            <strong><span className="whiteHeart" aria-hidden="true">❤</span> Favourites</strong>
            <CloseLink />
          </div>
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
