import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { CloseLink } from "@/components/close-link";
import { PlaylistEditor } from "@/components/playlist-editor";
import { ProtectedAuthGatePanel } from "@/components/protected-auth-gate-panel";
import { REFRESH_TOKEN_COOKIE } from "@/lib/auth-config";
import { getPlaylistById } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";

type PlaylistDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ name?: string | string[] }>;
};

export default async function PlaylistDetailPage({ params, searchParams }: PlaylistDetailPageProps) {
  const cookieStore = await cookies();
  const hasRefreshToken = Boolean(cookieStore.get(REFRESH_TOKEN_COOKIE)?.value);
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const fallbackName = typeof resolvedSearchParams?.name === "string" ? resolvedSearchParams.name.trim() : "";
  const authState = await getCurrentAuthenticatedUserAuthState();
  const user = authState.status === "authenticated" ? authState.user : null;
  const loadedPlaylist = user ? await getPlaylistById(id, user.id) : null;
  const playlist = loadedPlaylist ?? (user && fallbackName
    ? {
        id,
        name: fallbackName,
        videos: [],
      }
    : null);

  if (!user) {
    return (
      <>
        <div className="favouritesBlindBar">
          <div className="categoryHeaderBreadcrumb">
            <span className="categoryHeaderIcon whitePlaylistGlyph" aria-hidden="true">♬</span>
            <Link href="/playlists" className="categoryHeaderBreadcrumbLink">Playlists</Link>
            <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">/</span>
            <span className="categoryHeaderBreadcrumbCurrent">Playlist</span>
          </div>
          <CloseLink />
        </div>
            <ProtectedAuthGatePanel
              status={authState.status === "unavailable" ? "unavailable" : "unauthenticated"}
          heading="Playlist access"
          headingDetail="Login required"
          unauthenticatedMessage="You need an authenticated session to open saved playlists."
          className="panel featurePanel spanTwoColumns"
          hasRefreshToken={hasRefreshToken}
          unavailableMessage={authState.status === "unavailable" ? authState.message : undefined}
        />
      </>
    );
  }

  if (!playlist) {
    notFound();
  }

  return (
    <PlaylistEditor playlist={playlist} isAuthenticated={Boolean(user)} />
  );
}
