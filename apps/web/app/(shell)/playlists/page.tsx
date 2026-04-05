import { PlaylistsGrid } from "@/components/playlists-grid";
import { getPlaylists } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";

export default async function PlaylistsPage() {
  const user = await getCurrentAuthenticatedUser();
  const playlists = await getPlaylists(user?.id);

  return (
    <PlaylistsGrid initialPlaylists={playlists} isAuthenticated={Boolean(user)} />
  );
}
