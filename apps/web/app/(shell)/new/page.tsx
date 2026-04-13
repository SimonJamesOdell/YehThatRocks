import { cookies } from "next/headers";

import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { isAdminIdentity } from "@/lib/admin-auth";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";
import { getHiddenVideoIdsForUser, getSeenVideoIdsForUser } from "@/lib/catalog-data";
import { NewVideosLoader } from "@/components/new-videos-loader";

export default async function NewPage() {
  const cookieStore = await cookies();
  const isAuthenticated = Boolean(cookieStore.get(ACCESS_TOKEN_COOKIE)?.value);
  const user = await getCurrentAuthenticatedUser();
  const isAdminUser = Boolean(user && isAdminIdentity(user.id, user.email ?? ""));
  const seenVideoIds = user ? await getSeenVideoIdsForUser(user.id) : new Set<string>();
  const hiddenVideoIds = user ? await getHiddenVideoIdsForUser(user.id) : new Set<string>();

  return (
    <NewVideosLoader
      initialVideos={[]}
      isAuthenticated={isAuthenticated}
      isAdminUser={isAdminUser}
      seenVideoIds={Array.from(seenVideoIds)}
      hiddenVideoIds={Array.from(hiddenVideoIds)}
    />
  );
}