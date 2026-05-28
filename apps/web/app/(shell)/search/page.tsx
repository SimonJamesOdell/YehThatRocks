
import Link from "next/link";

import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import { AdminVideoDeleteButton } from "@/components/admin-video-delete-button";
import { AdminVideoEditButton } from "@/components/admin-video-edit-button";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { CloseLink } from "@/components/close-link";
import { OverlayHeader } from "@/components/overlay-header";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import { SearchResultFavouriteButton } from "@/components/search-result-favourite-button";
import { SearchResultBlockButton } from "@/components/search-result-block-button";
import { SearchFlagButton } from "@/components/search-flag-button";
import { SearchSeenToggle } from "@/components/search-seen-toggle";
import { SearchResultVideoLink } from "@/components/search-result-video-link";
import { inferArtistFromTitle } from "@/lib/catalog-metadata-utils";
import { getGenreSlug, searchCatalog } from "@/lib/catalog-data";
import { getSuppressedSearchVideoIds } from "@/lib/search-flag-data";
import { getShellRequestAuthState, getShellRequestVideoState } from "@/lib/shell-request-state";

type SearchPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type SearchArtistResult = {
  slug: string;
  name: string;
  genre: string;
};

type SearchVideoResult = {
  id: string;
  title: string;
  channelTitle: string;
  genre?: string | null;
  favourited?: number;
  description?: string | null;
};

type SearchCatalogPageResult = {
  artists: SearchArtistResult[];
  genres: string[];
  videos: SearchVideoResult[];
};

function inferTrackFromTitle(title: string, artist: string) {
  const trimmedTitle = title.trim();
  const trimmedArtist = artist.trim();
  if (!trimmedTitle || !trimmedArtist) {
    return trimmedTitle;
  }

  const separators = [" - ", " — ", " | "];
  for (const separator of separators) {
    const split = trimmedTitle.split(separator).map((part) => part.trim()).filter(Boolean);
    if (split.length < 2) {
      continue;
    }

    const [left, right] = split;
    if (left.toLowerCase() === trimmedArtist.toLowerCase()) {
      return right;
    }

    if (right.toLowerCase() === trimmedArtist.toLowerCase()) {
      return left;
    }
  }

  return trimmedTitle;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const [{ hasAccessToken: isAuthenticated, user, isAdmin: isAdminUser }, { seenVideoIds }] = await Promise.all([
    getShellRequestAuthState(),
    getShellRequestVideoState(),
  ]);
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const query = typeof resolvedSearchParams?.q === "string" ? resolvedSearchParams.q : "";
  const results = (await searchCatalog(query)) as SearchCatalogPageResult;
  const uniqueArtists = Array.from(new Map(results.artists.map((artist) => [artist.slug, artist])).values());
  const uniqueGenres = Array.from(new Set(results.genres));
  const suppressedVideoIds = await getSuppressedSearchVideoIds({ userId: user?.id ?? null, query });
  const uniqueVideos = results.videos.filter(
    (video, index, all) => all.findIndex((candidate) => candidate.id === video.id) === index,
  ).filter((video) => !suppressedVideoIds.has(video.id));

  return (
    <>
      <OverlayScrollReset />
      <OverlayHeader close={false}>
        <div className="newPageHeaderLeft">
          <strong>Search Results ({uniqueVideos.length + uniqueArtists.length + uniqueGenres.length})</strong>
          <SearchSeenToggle trackStackId="search-video-grid" hasSeen={uniqueVideos.some((v) => seenVideoIds.has(v.id))} isAuthenticated={isAuthenticated} />
        </div>
        <CloseLink />
      </OverlayHeader>

      <div id="search-video-grid" className="trackStack spanTwoColumns">
        {uniqueVideos.map((video) => {
          const isSeen = seenVideoIds.has(video.id);
          const rawDisplayTitle = video.title;
          const parsedArtistCandidate =
            video.channelTitle?.trim()
            || inferArtistFromTitle(rawDisplayTitle)?.trim()
            || "";
          const metadataArtist = parsedArtistCandidate || "Unknown Artist";
          const parsedTrackCandidate = inferTrackFromTitle(rawDisplayTitle, metadataArtist);
          const displayTitle = parsedArtistCandidate && parsedTrackCandidate
            ? `${parsedArtistCandidate.toUpperCase()} - ${parsedTrackCandidate}`
            : rawDisplayTitle;

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
              <SearchResultFavouriteButton
                videoId={video.id}
                title={video.title}
                isAuthenticated={isAuthenticated}
              />
              <SearchResultVideoLink video={video} displayTitle={displayTitle} isSeen={isSeen} />
              <span hidden className="videoSeenBadge videoSeenBadgeOverlay">Seen</span>
              <p hidden>
                <Link href={`/?v=${video.id}&resume=1`}>Open video</Link>
              </p>
              <p hidden>
                <ArtistWikiLink artistName={video.channelTitle} videoId={video.id} className="artistInlineLink">
                  {video.channelTitle}
                </ArtistWikiLink>
              </p>
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
