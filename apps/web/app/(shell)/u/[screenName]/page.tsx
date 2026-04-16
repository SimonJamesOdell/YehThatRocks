import { notFound } from "next/navigation";

import { UserProfilePanel } from "@/components/user-profile-panel";
import { getPublicUserProfile } from "@/lib/catalog-data";

type UserProfilePageProps = {
  params: Promise<{ screenName: string }>;
};

export default async function UserProfilePage({ params }: UserProfilePageProps) {
  const { screenName } = await params;
  const { user, favourites, playlists } = await getPublicUserProfile(decodeURIComponent(screenName));

  if (!user) {
    notFound();
  }

  return (
    <UserProfilePanel user={user} favourites={favourites} playlists={playlists} />
  );
}
