import { cookies } from "next/headers";
import Image from "next/image";
import Link from "next/link";

import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { isAdminIdentity } from "@/lib/admin-auth";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import { AdminVideoDeleteButton } from "@/components/admin-video-delete-button";
import { AdminVideoEditButton } from "@/components/admin-video-edit-button";
import { CloseLink } from "@/components/close-link";
import { NewScrollReset } from "@/components/new-scroll-reset";
import { SearchResultBlockButton } from "@/components/search-result-block-button";
import { SearchFlagButton } from "@/components/search-flag-button";
import { SearchSeenToggle } from "@/components/search-seen-toggle";
import { getGenreSlug, getSeenVideoIdsForUser, searchCatalog } from "@/lib/catalog-data";
import { getSuppressedSearchVideoIds } from "@/lib/search-flag-data";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";

type SearchPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const cookieStore = await cookies();
  const isAuthenticated = Boolean(cookieStore.get(ACCESS_TOKEN_COOKIE)?.value);
  const user = await getCurrentAuthenticatedUser();
  const isAdminUser = Boolean(user && isAdminIdentity(user.id, user.email ?? ""));
  const seenVideoIds = user ? await getSeenVideoIdsForUser(user.id) : new Set<string>();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const query = typeof resolvedSearchParams?.q === "string" ? resolvedSearchParams.q : "";
  const results = await searchCatalog(query);
  const uniqueArtists = Array.from(new Map(results.artists.map((artist) => [artist.slug, artist])).values());
  const uniqueGenres = Array.from(new Set(results.genres));
  const suppressedVideoIds = await getSuppressedSearchVideoIds({ userId: user?.id ?? null, query });
  const uniqueVideos = results.videos.filter(
    (video, index, all) => all.findIndex((candidate) => candidate.id === video.id) === index,
  ).filter((video) => !suppressedVideoIds.has(video.id));

  return (
    <>
      <NewScrollReset />
      <div className="favouritesBlindBar">
        <div className="newPageHeaderLeft">
          <strong>Search Results ({uniqueVideos.length + uniqueArtists.length + uniqueGenres.length})</strong>
          <SearchSeenToggle trackStackId="search-video-grid" hasSeen={uniqueVideos.some((v) => seenVideoIds.has(v.id))} isAuthenticated={isAuthenticated} />
        </div>
        <CloseLink />
      </div>

      <div id="search-video-grid" className="trackStack spanTwoColumns">
        {uniqueVideos.map((video) => {
          const isSeen = seenVideoIds.has(video.id);

          return (
            <article
              key={video.id}
              className={`trackCard leaderboardCard top100CardWithPlaylistAction top100CardCornerActions searchResultCard${isSeen ? " top100CardSeen" : ""}`}
              data-video-id={video.id}
            >
              {isAuthenticated ? <SearchResultBlockButton videoId={video.id} title={video.title} /> : null}
              {isAuthenticated ? <SearchFlagButton videoId={video.id} title={video.title} searchQuery={query} /> : null}
              <AdminVideoEditButton videoId={video.id} isAdmin={isAdminUser} />
              <AdminVideoDeleteButton videoId={video.id} title={video.title} isAdmin={isAdminUser} />
              <Link href={`/?v=${video.id}&resume=1`} className="linkedCard leaderboardTrackLink" prefetch={false}>
                <div className="queueBadge">Result</div>
                <div className="leaderboardThumbWrap">
                  <Image
                    src={`https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/mqdefault.jpg`}
                    alt=""
                    width={160}
                    height={90}
                    className="leaderboardThumb"
                    loading="lazy"
                    sizes="(max-width: 768px) 42vw, 160px"
                  />
                  {isSeen ? <span className="videoSeenBadge videoSeenBadgeOverlay">Seen</span> : null}
                </div>
                <div className="leaderboardMeta">
                  <h3>{video.title}</h3>
                  <p>
                    <ArtistWikiLink artistName={video.channelTitle} videoId={video.id} className="artistInlineLink">
                      {video.channelTitle}
                    </ArtistWikiLink>
                  </p>
                </div>
              </Link>
              <div className="top100CardAction">
                <AddToPlaylistButton
                  videoId={video.id}
                  isAuthenticated={isAuthenticated}
                  compact
                  className="top100CardPlaylistAddButton"
                />
              </div>
            </article>
          );
        })}
      </div>

      {(uniqueArtists.length > 0 || uniqueGenres.length > 0) && (
        <>
          <div className="panelHeading">
            <span>Catalogue matches</span>
            <strong>Artists and genres</strong>
          </div>
          <div className="catalogGrid compactGrid">
            {uniqueArtists.map((artist) => (
              <Link key={artist.slug} href={`/artist/${artist.slug}`} className="catalogCard linkedCard">
                <p className="statusLabel">Artist</p>
                <h3>{artist.name}</h3>
                <p>{artist.genre}</p>
              </Link>
            ))}
            {uniqueGenres.map((genre) => (
              <Link key={genre} href={`/categories/${getGenreSlug(genre)}`} className="catalogCard linkedCard">
                <p className="statusLabel">Genre</p>
                <h3>{genre}</h3>
                <p>Open category route</p>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
