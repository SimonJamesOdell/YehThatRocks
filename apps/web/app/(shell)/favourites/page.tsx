import { cookies } from "next/headers";

import { CloseLink } from "@/components/close-link";
import { FavouritesGrid } from "@/components/favourites-grid";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { getFavouriteVideos } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";

export default async function FavouritesPage() {
  const cookieStore = await cookies();
  const hasAccessToken = Boolean(cookieStore.get(ACCESS_TOKEN_COOKIE)?.value);
  const user = await getCurrentAuthenticatedUser();
  const favourites = user ? await getFavouriteVideos(user.id) : [];

  return (
    <>
      <div className="favouritesBlindBar">
        <strong><span className="whiteHeart" aria-hidden="true">❤️</span> Favourites</strong>
        <CloseLink />
      </div>

      <FavouritesGrid initialFavourites={favourites} isAuthenticated={hasAccessToken} />
    </>
  );
}
