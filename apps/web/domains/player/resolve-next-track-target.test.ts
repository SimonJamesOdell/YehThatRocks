import { describe, expect, it, vi } from "vitest";

import type { VideoRecord } from "@/lib/catalog";
import { resolveNextTrackTarget } from "@/domains/player/resolve-next-track-target";

function createVideo(id: string): VideoRecord {
  return {
    id,
    title: `title-${id}`,
    channelTitle: "channel",
    genre: "genre",
    favourited: 0,
    description: "desc",
  };
}

describe("resolveNextTrackTarget", () => {
  it("prioritizes playlist > temporary queue > route queue > random", () => {
    expect(resolveNextTrackTarget({
      activePlaylistId: "pl-1",
      hasActivePlaylistContext: true,
      playlistQueueIds: ["p1", "p2"],
      effectivePlaylistIndex: 0,
      temporaryQueue: [createVideo("q1"), createVideo("q2")],
      currentVideoId: "p1",
      isDockedDesktop: true,
      shouldUseRouteQueueRegardlessOfDocked: false,
      routeAutoplayQueueIds: ["r1", "r2"],
      getRandomWatchNextId: vi.fn(() => "rand"),
    })).toEqual({
      videoId: "p2",
      playlistItemIndex: 1,
      clearPlaylist: false,
    });
  });

  it("does not fall back when playlist is selected but unresolved", () => {
    const randomPicker = vi.fn(() => "rand");

    expect(resolveNextTrackTarget({
      activePlaylistId: "pl-1",
      hasActivePlaylistContext: false,
      playlistQueueIds: [],
      effectivePlaylistIndex: null,
      temporaryQueue: [createVideo("q1")],
      currentVideoId: "q1",
      isDockedDesktop: true,
      shouldUseRouteQueueRegardlessOfDocked: false,
      routeAutoplayQueueIds: ["r1", "r2"],
      getRandomWatchNextId: randomPicker,
    })).toBeNull();

    expect(randomPicker).not.toHaveBeenCalled();
  });

  it("falls back to temporary queue, route queue, then random", () => {
    expect(resolveNextTrackTarget({
      activePlaylistId: null,
      hasActivePlaylistContext: false,
      playlistQueueIds: [],
      effectivePlaylistIndex: null,
      temporaryQueue: [createVideo("q1"), createVideo("q2")],
      currentVideoId: "q1",
      isDockedDesktop: true,
      shouldUseRouteQueueRegardlessOfDocked: false,
      routeAutoplayQueueIds: ["r1", "r2"],
      getRandomWatchNextId: vi.fn(() => "rand"),
    })).toEqual({
      videoId: "q2",
      playlistItemIndex: null,
      clearPlaylist: true,
    });

    expect(resolveNextTrackTarget({
      activePlaylistId: null,
      hasActivePlaylistContext: false,
      playlistQueueIds: [],
      effectivePlaylistIndex: null,
      temporaryQueue: [],
      currentVideoId: "r1",
      isDockedDesktop: true,
      shouldUseRouteQueueRegardlessOfDocked: false,
      routeAutoplayQueueIds: ["r1", "r2"],
      getRandomWatchNextId: vi.fn(() => "rand"),
    })).toEqual({
      videoId: "r2",
      playlistItemIndex: null,
      clearPlaylist: true,
    });

    expect(resolveNextTrackTarget({
      activePlaylistId: null,
      hasActivePlaylistContext: false,
      playlistQueueIds: [],
      effectivePlaylistIndex: null,
      temporaryQueue: [],
      currentVideoId: "v1",
      isDockedDesktop: false,
      shouldUseRouteQueueRegardlessOfDocked: false,
      routeAutoplayQueueIds: [],
      getRandomWatchNextId: vi.fn(() => "rand"),
    })).toEqual({
      videoId: "rand",
      playlistItemIndex: null,
      clearPlaylist: true,
    });
  });

  it("allows route-queue next while autoplay is off", () => {
    expect(resolveNextTrackTarget({
      activePlaylistId: null,
      hasActivePlaylistContext: false,
      playlistQueueIds: [],
      effectivePlaylistIndex: null,
      temporaryQueue: [],
      currentVideoId: "r1",
      isDockedDesktop: true,
      shouldUseRouteQueueRegardlessOfDocked: false,
      routeAutoplayQueueIds: ["r1", "r2", "r3"],
      getRandomWatchNextId: vi.fn(() => "rand"),
    })).toEqual({
      videoId: "r2",
      playlistItemIndex: null,
      clearPlaylist: true,
    });
  });

  it("uses route queue when autoplay explicitly allows non-docked route queues", () => {
    expect(resolveNextTrackTarget({
      activePlaylistId: null,
      hasActivePlaylistContext: false,
      playlistQueueIds: [],
      effectivePlaylistIndex: null,
      temporaryQueue: [],
      currentVideoId: "r1",
      isDockedDesktop: false,
      shouldUseRouteQueueRegardlessOfDocked: true,
      routeAutoplayQueueIds: ["r1", "r2", "r3"],
      getRandomWatchNextId: vi.fn(() => "rand"),
    })).toEqual({
      videoId: "r2",
      playlistItemIndex: null,
      clearPlaylist: true,
    });
  });

  it("ignores non-docked route queue when override is disabled", () => {
    expect(resolveNextTrackTarget({
      activePlaylistId: null,
      hasActivePlaylistContext: false,
      playlistQueueIds: [],
      effectivePlaylistIndex: null,
      temporaryQueue: [],
      currentVideoId: "r1",
      isDockedDesktop: false,
      shouldUseRouteQueueRegardlessOfDocked: false,
      routeAutoplayQueueIds: ["r1", "r2", "r3"],
      getRandomWatchNextId: vi.fn(() => "rand"),
    })).toEqual({
      videoId: "rand",
      playlistItemIndex: null,
      clearPlaylist: true,
    });
  });
});
