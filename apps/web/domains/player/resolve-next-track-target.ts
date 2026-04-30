import type { VideoRecord } from "@/lib/catalog";
import { resolvePlaylistStepTarget } from "@/domains/playlist/playlist-step-target";
import { resolveTemporaryQueueTarget } from "@/domains/queue/temporary-queue";

export type ResolveTarget = {
  videoId: string;
  playlistItemIndex: number | null;
  clearPlaylist: boolean;
};

type NextTrackResolutionState =
  | "playlist"
  | "temporary-queue"
  | "route-queue"
  | "random-fallback";

type ResolutionOutcome =
  | { status: "resolved"; target: ResolveTarget }
  | { status: "blocked" }
  | { status: "unresolved" };

export type ResolveNextTrackTargetOptions = {
  activePlaylistId: string | null;
  hasActivePlaylistContext: boolean;
  playlistQueueIds: string[];
  effectivePlaylistIndex: number | null;
  temporaryQueue: VideoRecord[];
  currentVideoId: string;
  isDockedDesktop: boolean;
  routeAutoplayQueueIds: string[];
  getRandomWatchNextId: () => string | null;
};

function resolveRouteQueueTarget(options: {
  isDockedDesktop: boolean;
  routeAutoplayQueueIds: string[];
  currentVideoId: string;
}): ResolveTarget | null {
  const {
    isDockedDesktop,
    routeAutoplayQueueIds,
    currentVideoId,
  } = options;

  if (isDockedDesktop && routeAutoplayQueueIds.length > 0) {
    const currentIndex = routeAutoplayQueueIds.findIndex((videoId) => videoId === currentVideoId);
    const fallbackIndex = routeAutoplayQueueIds.findIndex((videoId) => videoId !== currentVideoId);
    const nextIndex = currentIndex >= 0
      ? (currentIndex + 1) % routeAutoplayQueueIds.length
      : fallbackIndex;
    const nextId = nextIndex >= 0 ? routeAutoplayQueueIds[nextIndex] ?? null : null;

    if (nextId) {
      return {
        videoId: nextId,
        playlistItemIndex: null,
        clearPlaylist: true,
      };
    }
  }

  return null;
}

function resolveRandomFallbackTarget(getRandomWatchNextId: () => string | null): ResolveTarget | null {
  const randomWatchNextId = getRandomWatchNextId();

  if (!randomWatchNextId) {
    return null;
  }

  return {
    videoId: randomWatchNextId,
    playlistItemIndex: null,
    clearPlaylist: true,
  };
}

export function resolveNextTrackTarget(options: ResolveNextTrackTargetOptions): ResolveTarget | null {
  const priorityMachine: Array<{
    state: NextTrackResolutionState;
    evaluate: () => ResolutionOutcome;
  }> = [
    {
      state: "playlist",
      evaluate: () => {
        if (!options.activePlaylistId) {
          return { status: "unresolved" };
        }

        const nextPlaylistTarget = resolvePlaylistStepTarget({
          hasActivePlaylistContext: options.hasActivePlaylistContext,
          playlistQueueIds: options.playlistQueueIds,
          effectivePlaylistIndex: options.effectivePlaylistIndex,
          step: 1,
        });

        if (nextPlaylistTarget) {
          return {
            status: "resolved",
            target: {
              videoId: nextPlaylistTarget.videoId,
              playlistItemIndex: nextPlaylistTarget.playlistItemIndex,
              clearPlaylist: false,
            },
          };
        }

        // A playlist is selected but not ready yet; do not switch to lower-priority states.
        return { status: "blocked" };
      },
    },
    {
      state: "temporary-queue",
      evaluate: () => {
        const nextQueuedVideoId = resolveTemporaryQueueTarget(options.temporaryQueue, options.currentVideoId);

        return nextQueuedVideoId
          ? {
            status: "resolved",
            target: {
              videoId: nextQueuedVideoId,
              playlistItemIndex: null,
              clearPlaylist: true,
            },
          }
          : { status: "unresolved" };
      },
    },
    {
      state: "route-queue",
      evaluate: () => {
        const target = resolveRouteQueueTarget({
          isDockedDesktop: options.isDockedDesktop,
          routeAutoplayQueueIds: options.routeAutoplayQueueIds,
          currentVideoId: options.currentVideoId,
        });

        return target
          ? { status: "resolved", target }
          : { status: "unresolved" };
      },
    },
    {
      state: "random-fallback",
      evaluate: () => {
        const target = resolveRandomFallbackTarget(options.getRandomWatchNextId);

        return target
          ? { status: "resolved", target }
          : { status: "unresolved" };
      },
    },
  ];

  for (const step of priorityMachine) {
    const outcome = step.evaluate();

    if (outcome.status === "resolved") {
      return outcome.target;
    }

    if (outcome.status === "blocked") {
      return null;
    }
  }

  return null;
}
