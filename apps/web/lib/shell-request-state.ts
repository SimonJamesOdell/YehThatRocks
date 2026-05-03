import { cache } from "react";
import { cookies } from "next/headers";

import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { isAdminIdentity } from "@/lib/admin-auth";
import { getHiddenVideoIdsForUser, getSeenVideoIdsForUser } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUserAuthStateByAccessToken } from "@/lib/server-auth";

const getShellRequestAuthStateInternal = cache(async () => {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const hasAccessToken = Boolean(accessToken);
  const authState = await getCurrentAuthenticatedUserAuthStateByAccessToken(accessToken);
  const user = authState.status === "authenticated" ? authState.user : null;
  const isAdmin = Boolean(user && isAdminIdentity(user.id, user.email ?? ""));

  return {
    hasAccessToken,
    authState,
    user,
    isAdmin,
  };
});

const getShellRequestVideoStateInternal = cache(async () => {
  const { user } = await getShellRequestAuthStateInternal();
  if (!user) {
    return {
      seenVideoIds: new Set<string>(),
      hiddenVideoIds: new Set<string>(),
    };
  }

  const [seenVideoIds, hiddenVideoIds] = await Promise.all([
    getSeenVideoIdsForUser(user.id),
    getHiddenVideoIdsForUser(user.id),
  ]);

  return {
    seenVideoIds,
    hiddenVideoIds,
  };
});

export async function getShellRequestAuthState() {
  return getShellRequestAuthStateInternal();
}

export async function getShellRequestVideoState() {
  return getShellRequestVideoStateInternal();
}
