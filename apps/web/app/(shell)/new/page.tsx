import { cookies } from "next/headers";

import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";
import { getHiddenVideoIdsForUser, getSeenVideoIdsForUser } from "@/lib/catalog-data";
import { CloseLink } from "@/components/close-link";
import { NewScrollReset } from "@/components/new-scroll-reset";
import { NewVideosLoader } from "@/components/new-videos-loader";

export default async function NewPage() {
  const cookieStore = await cookies();
  const isAuthenticated = Boolean(cookieStore.get(ACCESS_TOKEN_COOKIE)?.value);
  const user = await getCurrentAuthenticatedUser();
  const seenVideoIds = user ? await getSeenVideoIdsForUser(user.id) : new Set<string>();
  const hiddenVideoIds = user ? await getHiddenVideoIdsForUser(user.id) : new Set<string>();

  return (
    <>
      <NewScrollReset />

      <div className="favouritesBlindBar">
        <strong><span style={{filter: "brightness(0) invert(1)"}}>⭐</span> New</strong>
        <CloseLink />
      </div>

      <NewVideosLoader
        initialVideos={[]}
        isAuthenticated={isAuthenticated}
        seenVideoIds={Array.from(seenVideoIds)}
        hiddenVideoIds={Array.from(hiddenVideoIds)}
      />
    </>
  );
}