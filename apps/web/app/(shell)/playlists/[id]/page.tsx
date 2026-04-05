import Link from "next/link";
import { notFound } from "next/navigation";

import { CloseLink } from "@/components/close-link";
import { PlaylistEditor } from "@/components/playlist-editor";
import { getPlaylistById } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";

type PlaylistDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ name?: string | string[] }>;
};

export default async function PlaylistDetailPage({ params, searchParams }: PlaylistDetailPageProps) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const fallbackName = typeof resolvedSearchParams?.name === "string" ? resolvedSearchParams.name.trim() : "";
  const user = await getCurrentAuthenticatedUser();
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
        <section className="panel featurePanel spanTwoColumns">
          <div className="panelHeading">
            <span>Playlist access</span>
            <strong>Login required</strong>
          </div>
          <p className="authMessage">You need an authenticated session to open saved playlists.</p>
          <div className="primaryActions compactActions">
            <Link href="/login" className="navLink navLinkActive">Login</Link>
            <Link href="/register" className="navLink">Register</Link>
          </div>
        </section>
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
