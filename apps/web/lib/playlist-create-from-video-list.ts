import type { useRouter } from "next/navigation";

import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";
import { addPlaylistItemsClient, createPlaylistClient, type PlaylistMutationPayload } from "@/lib/playlist-client-service";

type RouterInstance = ReturnType<typeof useRouter>;

type PlaylistVideoLike = {
  id: string;
  title: string;
  channelTitle: string;
  thumbnail?: string | null;
};

type PlaylistCreateSuccessMessageArgs = {
  playlistName: string;
  addedCount: number;
  requestedCount: number;
};

type OptimisticPlaylistSyncMode = {
  kind: "immediate";
} | {
  kind: "staggered";
  animatedTrackLimit?: number;
  stepMs?: number;
  settleDelayMs?: number;
  reconcileOnlyWhenChanged?: boolean;
};

type CreatePlaylistFromVideoListOptions<TVideo extends PlaylistVideoLike> = {
  isAuthenticated: boolean;
  sourceVideos: TVideo[];
  playlistName: string;
  router: RouterInstance;
  currentVideoId: string | null;
  telemetryComponent: string;
  setStatus: (message: string | null) => void;
  emptyMessage: string;
  createFailedMessage: string;
  optimisticMode?: OptimisticPlaylistSyncMode;
  onBuildSuccessMessage?: (args: PlaylistCreateSuccessMessageArgs) => string | null;
  signInMessage?: string;
  addPartiallyFailedMessage?: string;
  addFailedMessage?: string;
  dispatchCreationProgressDone?: boolean;
};

function buildPlaylistCloseHref(currentVideoId: string | null, playlistId: string) {
  if (currentVideoId) {
    return `/?v=${encodeURIComponent(currentVideoId)}&pl=${encodeURIComponent(playlistId)}&resume=1`;
  }

  return `/?pl=${encodeURIComponent(playlistId)}`;
}

function toVideoIds<TVideo extends PlaylistVideoLike>(videos: TVideo[]) {
  return videos
    .map((video) => video.id)
    .filter((videoId): videoId is string => Boolean(videoId));
}

export async function createPlaylistFromVideoList<TVideo extends PlaylistVideoLike>({
  isAuthenticated,
  sourceVideos,
  playlistName,
  router,
  currentVideoId,
  telemetryComponent,
  setStatus,
  emptyMessage,
  createFailedMessage,
  optimisticMode = { kind: "immediate" },
  onBuildSuccessMessage,
  signInMessage = "Sign in to create playlists.",
  addPartiallyFailedMessage = "Playlist was created, but some tracks could not be saved.",
  addFailedMessage = "Playlist was created, but tracks could not be saved.",
  dispatchCreationProgressDone = false,
}: CreatePlaylistFromVideoListOptions<TVideo>) {
  if (!isAuthenticated) {
    setStatus(signInMessage);
    return;
  }

  const videoIds = toVideoIds(sourceVideos);
  if (videoIds.length === 0) {
    setStatus(emptyMessage);
    return;
  }

  setStatus(null);

  let createdPlaylistIdForProgress: string | null = null;

  try {
    const createResponse = await createPlaylistClient(
      {
        name: playlistName,
        videoIds: [],
      },
      {
        telemetryContext: {
          component: telemetryComponent,
        },
      },
    );

    if (!createResponse.ok && (createResponse.error.code === "unauthorized" || createResponse.error.code === "forbidden")) {
      setStatus(signInMessage);
      return;
    }

    if (!createResponse.ok) {
      setStatus(createFailedMessage);
      return;
    }

    const created = createResponse.data as { id?: string };
    const createdPlaylistId = created?.id;

    if (!createdPlaylistId) {
      setStatus(createFailedMessage);
      return;
    }

    createdPlaylistIdForProgress = createdPlaylistId;

    const closeHref = buildPlaylistCloseHref(currentVideoId, createdPlaylistId);

    dispatchAppEvent(EVENT_NAMES.OVERLAY_CLOSE_REQUEST, { href: closeHref });
    dispatchAppEvent(EVENT_NAMES.RIGHT_RAIL_MODE, {
      mode: "playlist",
      playlistId: createdPlaylistId,
    });
    router.push(closeHref);

    let animationDoneMs = 0;

    if (optimisticMode.kind === "staggered") {
      const stepMs = optimisticMode.stepMs ?? 22;
      const settleDelayMs = optimisticMode.settleDelayMs ?? 40;
      const animatedTrackLimit = optimisticMode.animatedTrackLimit ?? 40;
      const animatedVideos = sourceVideos.slice(0, animatedTrackLimit);
      const optimisticItemCount = sourceVideos.length;

      for (let index = 0; index < animatedVideos.length; index += 1) {
        const video = animatedVideos[index];

        window.setTimeout(() => {
          const visible = sourceVideos.slice(0, index + 1);

          dispatchAppEvent(EVENT_NAMES.PLAYLIST_RAIL_SYNC, {
            playlist: {
              id: createdPlaylistId,
              name: playlistName,
              videos: visible,
              itemCount: optimisticItemCount,
            },
          });

          dispatchAppEvent(EVENT_NAMES.RIGHT_RAIL_MODE, {
            mode: "playlist",
            playlistId: createdPlaylistId,
            trackId: video.id,
          });
        }, index * stepMs);
      }

      animationDoneMs = animatedVideos.length * stepMs + settleDelayMs;

      window.setTimeout(() => {
        dispatchAppEvent(EVENT_NAMES.PLAYLIST_RAIL_SYNC, {
          playlist: {
            id: createdPlaylistId,
            name: playlistName,
            videos: sourceVideos,
            itemCount: sourceVideos.length,
          },
        });
      }, animationDoneMs);

      if (dispatchCreationProgressDone) {
        window.setTimeout(() => {
          dispatchAppEvent(EVENT_NAMES.PLAYLIST_CREATION_PROGRESS, {
            playlistId: createdPlaylistId,
            phase: "done",
          });
        }, animationDoneMs);
      }
    } else {
      dispatchAppEvent(EVENT_NAMES.PLAYLIST_RAIL_SYNC, {
        playlist: {
          id: createdPlaylistId,
          name: playlistName,
          videos: sourceVideos,
          itemCount: sourceVideos.length,
        },
      });
    }

    void addPlaylistItemsClient(
      { playlistId: createdPlaylistId, videoIds },
      { telemetryContext: { component: telemetryComponent } },
    )
      .then((addAllResponse) => {
        if (!addAllResponse.ok) {
          setStatus(addPartiallyFailedMessage);
          dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);
          return;
        }

        const updatedPlaylist = addAllResponse.data as PlaylistMutationPayload | undefined;
        const finalVideos = Array.isArray(updatedPlaylist?.videos) ? updatedPlaylist.videos : sourceVideos;
        const finalName = updatedPlaylist?.name ?? playlistName;
        const finalItemCount = updatedPlaylist?.itemCount ?? finalVideos.length;

        let shouldDispatchFinalSync = true;
        if (optimisticMode.kind === "staggered" && optimisticMode.reconcileOnlyWhenChanged) {
          const optimisticIds = sourceVideos.map((video) => video.id).join(",");
          const serverIds = finalVideos.map((video) => video.id).join(",");
          shouldDispatchFinalSync = serverIds !== optimisticIds || finalName !== playlistName;
        }

        if (shouldDispatchFinalSync) {
          const syncDelayMs = optimisticMode.kind === "staggered" ? animationDoneMs : 0;
          window.setTimeout(() => {
            dispatchAppEvent(EVENT_NAMES.PLAYLIST_RAIL_SYNC, {
              playlist: {
                id: createdPlaylistId,
                name: finalName,
                videos: finalVideos,
                itemCount: finalItemCount,
              },
            });
          }, syncDelayMs);
        }

        dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);

        if (onBuildSuccessMessage) {
          const message = onBuildSuccessMessage({
            playlistName: finalName,
            addedCount: finalVideos.length,
            requestedCount: videoIds.length,
          });
          if (message) {
            setStatus(message);
          }
        }
      })
      .catch(() => {
        setStatus(addFailedMessage);
        dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);
      });
  } catch {
    if (dispatchCreationProgressDone && createdPlaylistIdForProgress) {
      dispatchAppEvent(EVENT_NAMES.PLAYLIST_CREATION_PROGRESS, {
        playlistId: createdPlaylistIdForProgress,
        phase: "failed",
      });
    }

    setStatus(createFailedMessage);
  }
}
