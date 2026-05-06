import { cache } from "react";
import { cookies } from "next/headers";

import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { isAdminIdentity } from "@/lib/admin-auth";
import { getHiddenVideoIdsForUser, getSeenVideoIdsForUser } from "@/lib/catalog-data";
import { withSoftTimeout } from "@/lib/catalog-data-utils";
import { getCurrentAuthenticatedUserAuthStateByAccessToken } from "@/lib/server-auth";

const SHELL_AUTH_STATE_TIMEOUT_MS = 3_000;
const SHELL_VIDEO_STATE_TIMEOUT_MS = 3_000;

const getShellRequestAuthStateInternal = cache(async () => {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const hasAccessToken = Boolean(accessToken);
  const authState = await withSoftTimeout(
    `shell-request-auth:${hasAccessToken ? "token" : "guest"}`,
    SHELL_AUTH_STATE_TIMEOUT_MS,
    () => getCurrentAuthenticatedUserAuthStateByAccessToken(accessToken),
  ).catch(() => ({
    status: "unavailable" as const,
    message: "The auth server is not responding, so your authorization status cannot currently be confirmed.",
  }));
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

  const [seenVideoIds, hiddenVideoIds] = await withSoftTimeout(
    `shell-request-video-state:${user.id}`,
    SHELL_VIDEO_STATE_TIMEOUT_MS,
    () => Promise.all([
      getSeenVideoIdsForUser(user.id),
      getHiddenVideoIdsForUser(user.id),
    ]),
  ).catch(() => [new Set<string>(), new Set<string>()] as const);

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
