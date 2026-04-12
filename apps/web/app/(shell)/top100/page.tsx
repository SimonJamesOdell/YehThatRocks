import { cookies } from "next/headers";

import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { CloseLink } from "@/components/close-link";
import { Top100VideosLoader } from "@/components/top100-videos-loader";
import { getHiddenVideoIdsForUser, getSeenVideoIdsForUser } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";

export default async function TopHundredPage() {
  const cookieStore = await cookies();
  const isAuthenticated = Boolean(cookieStore.get(ACCESS_TOKEN_COOKIE)?.value);
  const user = await getCurrentAuthenticatedUser();
  const seenVideoIds = user ? await getSeenVideoIdsForUser(user.id) : new Set<string>();
  const hiddenVideoIds = user ? await getHiddenVideoIdsForUser(user.id) : new Set<string>();

  return (
    <>
      <div className="favouritesBlindBar">
        <strong>Top 100</strong>
        <CloseLink />
      </div>

      <Top100VideosLoader
        isAuthenticated={isAuthenticated}
        seenVideoIds={Array.from(seenVideoIds)}
        hiddenVideoIds={Array.from(hiddenVideoIds)}
      />
    </>
  );
}
