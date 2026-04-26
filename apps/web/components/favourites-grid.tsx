"use client";

import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { CloseLink } from "@/components/close-link";
import type { VideoRecord } from "@/lib/catalog";
import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";

type FavouritesGridProps = {
  initialFavourites: VideoRecord[];
  isAuthenticated: boolean;
};

export function FavouritesGrid({ initialFavourites, isAuthenticated }: FavouritesGridProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [favourites, setFavourites] = useState<VideoRecord[]>(initialFavourites);
  const [filterValue, setFilterValue] = useState("");
  const [pendingVideoId, setPendingVideoId] = useState<string | null>(null);
  const [isCreatingPlaylistFromFavourites, setIsCreatingPlaylistFromFavourites] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredFavourites = useMemo(() => {
    const needle = filterValue.trim().toLowerCase();
    if (!needle) {
      return favourites;
    }

    return favourites.filter((track) => {
      const title = track.title.toLowerCase();
      const artist = track.channelTitle.toLowerCase();
      return title.startsWith(needle) || artist.startsWith(needle);
    });
  }, [filterValue, favourites]);

  useEffect(() => {
    if (!isAuthenticated || pathname !== "/favourites") {
      return;
    }

    let isCancelled = false;

    async function refreshFavourites() {
      try {
        const response = await fetchWithAuthRetry("/api/favourites", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | {
              favourites?: VideoRecord[];
            }
          | null;

        if (!isCancelled && Array.isArray(payload?.favourites)) {
          setFavourites(payload.favourites);
        }
      } catch {
        // Keep the initial server-provided favourites if refresh fails.
      }
    }

    void refreshFavourites();

    const handleFavouritesUpdated = () => {
      void refreshFavourites();
    };

    window.addEventListener("ytr:favourites-updated", handleFavouritesUpdated);

    return () => {
      isCancelled = true;
      window.removeEventListener("ytr:favourites-updated", handleFavouritesUpdated);
    };
  }, [isAuthenticated, pathname]);

  function removeFavourite(videoId: string) {
    if (!isAuthenticated) {
      setMessage("Sign in to manage favourites.");
      return;
    }

    startTransition(async () => {
      setPendingVideoId(videoId);
      setMessage(null);

      try {
        const response = await fetchWithAuthRetry("/api/favourites", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            videoId,
            action: "remove",
          }),
        });

        if (response.status === 401 || response.status === 403) {
          setMessage("Sign in to manage favourites.");
          return;
        }

        if (!response.ok) {
          setMessage("Could not remove favourite. Please try again.");
          return;
        }

        setFavourites((current) => current.filter((track) => track.id !== videoId));
        setMessage("Track removed from favourites.");
      } catch {
        setMessage("Could not remove favourite. Please try again.");
      } finally {
        setPendingVideoId(null);
      }
    });
  }

  function openVideo(videoId: string) {
    router.push(`/?v=${encodeURIComponent(videoId)}&resume=1`);
  }

  async function createPlaylistFromFavourites() {
    if (!isAuthenticated) {
      setMessage("Sign in to create playlists.");
      return;
    }

    const favouriteVideoIds = favourites.map((track) => track.id).filter(Boolean);

    if (favouriteVideoIds.length === 0) {
      setMessage("No favourites available to add.");
      return;
    }

    setIsCreatingPlaylistFromFavourites(true);
    setMessage(null);

    const playlistName = `Favourites ${new Date().toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`;
    let createdPlaylistIdForProgress: string | null = null;

    try {
      const createResponse = await fetch("/api/playlists", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: playlistName,
          videoIds: [],
        }),
      });

      if (createResponse.status === 401 || createResponse.status === 403) {
        setMessage("Sign in to create playlists.");
        return;
      }

      if (!createResponse.ok) {
        setMessage("Could not create playlist from favourites. Please try again.");
        return;
      }

      const created = (await createResponse.json().catch(() => null)) as { id?: string; name?: string } | null;
      const createdPlaylistId = created?.id;

      if (!createdPlaylistId) {
        setMessage("Could not create playlist from favourites. Please try again.");
        return;
      }

      createdPlaylistIdForProgress = createdPlaylistId;

      // Navigate and open the rail immediately — no loading state needed.
      const currentVideoId = searchParams.get("v");
      const closeHref = currentVideoId
        ? `/?v=${encodeURIComponent(currentVideoId)}&pl=${encodeURIComponent(createdPlaylistId)}&resume=1`
        : `/?pl=${encodeURIComponent(createdPlaylistId)}`;

      window.dispatchEvent(new CustomEvent("ytr:overlay-close-request", {
        detail: { href: closeHref },
      }));
      window.dispatchEvent(new CustomEvent("ytr:right-rail-mode", {
        detail: { mode: "playlist", playlistId: createdPlaylistId },
      }));
      router.push(closeHref);

      // Immediately populate the rail from the already-loaded favourites list
      // using a staggered reveal so tracks animate in without waiting for the server.
      const ANIMATED_TRACK_LIMIT = 40;
      const optimisticVideos = favourites;
      const animatedVideos = optimisticVideos.slice(0, ANIMATED_TRACK_LIMIT);
      const optimisticItemCount = optimisticVideos.length;

      for (let index = 0; index < animatedVideos.length; index += 1) {
        const video = animatedVideos[index];

        window.setTimeout(() => {
          const visible = optimisticVideos.slice(0, index + 1);

          window.dispatchEvent(new CustomEvent("ytr:playlist-rail-sync", {
            detail: {
              playlist: {
                id: createdPlaylistId,
                name: playlistName,
                videos: visible,
                itemCount: optimisticItemCount,
              },
              trackId: video.id,
            },
          }));

          window.dispatchEvent(new CustomEvent("ytr:right-rail-mode", {
            detail: {
              mode: "playlist",
              playlistId: createdPlaylistId,
              trackId: video.id,
            },
          }));
        }, index * 22);
      }

      // Once the optimistic animation is done, send the full list to the server
      // in the background and reconcile with the authoritative server response.
      const animationDoneMs = animatedVideos.length * 22 + 40;

      window.setTimeout(() => {
        // Show all tracks (including any beyond ANIMATED_TRACK_LIMIT) optimistically.
        window.dispatchEvent(new CustomEvent("ytr:playlist-rail-sync", {
          detail: {
            playlist: {
              id: createdPlaylistId,
              name: playlistName,
              videos: optimisticVideos,
              itemCount: optimisticItemCount,
            },
          },
        }));
      }, animationDoneMs);

      // Fire bulk add in background; reconcile rail with server truth when it returns.
      void fetch(`/api/playlists/${encodeURIComponent(createdPlaylistId)}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoIds: favouriteVideoIds }),
      }).then(async (addAllResponse) => {
        if (!addAllResponse.ok) {
          setMessage("Playlist was created, but some tracks could not be saved.");
          window.dispatchEvent(new Event("ytr:playlists-updated"));
          return;
        }

        const updatedPlaylist = (await addAllResponse.json().catch(() => null)) as
          | { id?: string; videos?: VideoRecord[]; itemCount?: number; name?: string }
          | null;

        const finalVideos = Array.isArray(updatedPlaylist?.videos) ? updatedPlaylist.videos : optimisticVideos;
        const finalName = updatedPlaylist?.name ?? playlistName;
        const finalItemCount = updatedPlaylist?.itemCount ?? finalVideos.length;

        // Only reconcile if the server returned a meaningfully different set
        // (different IDs order/count or name) to avoid a redundant re-render.
        const optimisticIds = optimisticVideos.map((v) => v.id).join(",");
        const serverIds = finalVideos.map((v) => v.id).join(",");
        if (serverIds !== optimisticIds || finalName !== playlistName) {
          window.dispatchEvent(new CustomEvent("ytr:playlist-rail-sync", {
            detail: {
              playlist: {
                id: createdPlaylistId,
                name: finalName,
                videos: finalVideos,
                itemCount: finalItemCount,
              },
            },
          }));
        }

        window.dispatchEvent(new Event("ytr:playlists-updated"));

        const addedCount = finalVideos.length;
        if (addedCount < favouriteVideoIds.length) {
          setMessage(`Created playlist "${finalName}" with ${addedCount}/${favouriteVideoIds.length} tracks.`);
        } else {
          setMessage(`Created playlist "${finalName}" with all ${addedCount} favourites.`);
        }
      }).catch(() => {
        setMessage("Playlist was created, but tracks could not be saved.");
        window.dispatchEvent(new Event("ytr:playlists-updated"));
      });

      // Mark creation complete once the optimistic animation has finished.
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("ytr:playlist-creation-progress", {
          detail: { playlistId: createdPlaylistId, phase: "done" },
        }));
      }, animationDoneMs);
    } catch {
      if (createdPlaylistIdForProgress) {
        window.dispatchEvent(new CustomEvent("ytr:playlist-creation-progress", {
          detail: { playlistId: createdPlaylistIdForProgress, phase: "failed" },
        }));
      }
      setMessage("Could not create playlist from favourites. Please try again.");
    } finally {
      setIsCreatingPlaylistFromFavourites(false);
    }
  }

  return (
    <>
      <div className="favouritesBlindBar categoriesHeaderBar">
        <div className="categoriesHeaderMain">
          <strong><span className="whiteHeart" aria-hidden="true">❤️</span> Favourites ({favourites.length})</strong>
          <div className="categoriesFilterBar">
            <input
              type="text"
              className="categoriesFilterInput"
              placeholder="type to filter..."
              value={filterValue}
              onChange={(event) => setFilterValue(event.target.value)}
              aria-label="Filter favourites by prefix"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="categoriesHeaderActions">
            {isAuthenticated ? (
              <button
                type="button"
                className="newPageSeenToggle favouritesCreatePlaylistButton"
                onClick={() => {
                  void createPlaylistFromFavourites();
                }}
                disabled={favourites.length === 0 || isCreatingPlaylistFromFavourites}
              >
                  {isCreatingPlaylistFromFavourites ? "+ Creating..." : "+ New Playlist"}
              </button>
            ) : null}
          </div>
        </div>
        <CloseLink />
      </div>

      {filteredFavourites.length > 0 ? (
        <div className="catalogGrid favouritesCatalogGrid">
          {filteredFavourites.map((track) => {
            const isRemoving = pendingVideoId === track.id;

            return (
              <article
                key={track.id}
                className="catalogCard categoryCard favouritesCardCompact playlistCardInteractive"
                role="link"
                tabIndex={0}
                aria-label={`Play ${track.title}`}
                onClick={() => openVideo(track.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openVideo(track.id);
                  }
                }}
              >
                <div className="favouritesThumbOverlayWrap">
                  <div className="categoryThumbWrap">
                    <Image
                      src={`https://i.ytimg.com/vi/${track.id}/mqdefault.jpg`}
                      alt=""
                      width={320}
                      height={180}
                      className="categoryThumb"
                      loading="lazy"
                      sizes="(max-width: 768px) 92vw, (max-width: 1200px) 44vw, 320px"
                    />
                  </div>
                  <button
                    type="button"
                    className="favouritesDeleteButton favouritesDeleteOverlayButton"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeFavourite(track.id);
                    }}
                    disabled={!isAuthenticated || isPending || isRemoving || isCreatingPlaylistFromFavourites}
                    aria-label={`Remove ${track.title} from favourites`}
                    title="Remove from favourites"
                  >
                    {isRemoving ? "…" : "🗑"}
                  </button>
                </div>
                <div className="relatedCardSourceBadges artistVideoSourceBadges">
                  {track.isFavouriteSource ? <span className="relatedSourceBadge relatedSourceBadgeFavourite">Favourite</span> : null}
                  {track.isTop100Source ? <span className="relatedSourceBadge relatedSourceBadgeTop100">Top100</span> : null}
                  {track.isNewSource ? <span className="relatedSourceBadge relatedSourceBadgeNew">New</span> : null}
                </div>
                <h3>
                  <span className="cardTitleLink playlistCardTitleStatic">
                    {track.title}
                  </span>
                </h3>
                <p>
                  <ArtistWikiLink artistName={track.channelTitle} videoId={track.id} className="artistInlineLink">
                    {track.channelTitle}
                  </ArtistWikiLink>
                </p>
                <div className="actionRow favouritesCardActionsRow">
                  <div
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <AddToPlaylistButton
                      videoId={track.id}
                      isAuthenticated={isAuthenticated}
                      compact
                      className="favouritesPlaylistCircleButton"
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="favouritesEmptyState" role="status" aria-live="polite">
          {favourites.length > 0 ? (
            <>
              <h3>No favourites match that prefix.</h3>
              <p>Try a shorter starting string.</p>
            </>
          ) : (
            <>
              <h3>There are no favourites saved yet.</h3>
              <p>Save tracks with the heart button to build your favourites list.</p>
            </>
          )}
        </div>
      )}

      {message ? <p className="mutationMessage">{message}</p> : null}
    </>
  );
}
