import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { UserProfilePanel } from "@/components/user-profile-panel";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { getPublicUserProfile, getSeenVideoIdsForUser } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";

type UserProfilePageProps = {
  params: Promise<{ screenName: string }>;
};

export default async function UserProfilePage({ params }: UserProfilePageProps) {
  const cookieStore = await cookies();
  const hasAccessToken = Boolean(cookieStore.get(ACCESS_TOKEN_COOKIE)?.value);
  const authState = await getCurrentAuthenticatedUserAuthState();
  const viewer = authState.status === "authenticated" ? authState.user : null;
  const seenVideoIds = viewer ? await getSeenVideoIdsForUser(viewer.id) : new Set<string>();
  const { screenName } = await params;
  const { user, favourites, playlists } = await getPublicUserProfile(decodeURIComponent(screenName));

  if (!user) {
    notFound();
  }

  return (
    <UserProfilePanel
      user={user}
      favourites={favourites}
      playlists={playlists}
      isAuthenticated={hasAccessToken}
      seenVideoIds={Array.from(seenVideoIds)}
    />
  );
}
