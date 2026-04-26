import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { VideoRecord } from "@/lib/catalog";
import { useNextTrackDecision } from "@/components/use-next-track-decision";

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

describe("useNextTrackDecision", () => {
  it("prioritizes active playlist over temporary queue, route queue, and random fallback", () => {
    const { result } = renderHook(() => useNextTrackDecision({
      activePlaylistId: "pl-1",
      hasActivePlaylistContext: true,
      playlistQueueIds: ["p1", "p2"],
      effectivePlaylistIndex: 0,
      temporaryQueue: [createVideo("q1"), createVideo("q2")],
      currentVideoId: "p1",
      isDockedDesktop: true,
      autoplayEnabled: true,
      routeAutoplayQueueIds: ["r1", "r2"],
      getRandomWatchNextId: vi.fn(() => "rand"),
    }));

    expect(result.current.resolveNextTarget()).toEqual({
      videoId: "p2",
      playlistItemIndex: 1,
      clearPlaylist: false,
    });
  });

  it("prioritizes temporary queue over route autoplay queue and random fallback", () => {
    const { result } = renderHook(() => useNextTrackDecision({
      activePlaylistId: null,
      hasActivePlaylistContext: false,
      playlistQueueIds: [],
      effectivePlaylistIndex: null,
      temporaryQueue: [createVideo("q1"), createVideo("q2")],
      currentVideoId: "q1",
      isDockedDesktop: true,
      autoplayEnabled: true,
      routeAutoplayQueueIds: ["r1", "r2"],
      getRandomWatchNextId: vi.fn(() => "rand"),
    }));

    expect(result.current.resolveNextTarget()).toEqual({
      videoId: "q2",
      playlistItemIndex: null,
      clearPlaylist: true,
    });
  });

  it("prioritizes route autoplay queue over random fallback when queue sources are empty", () => {
    const randomPicker = vi.fn(() => "rand");

    const { result } = renderHook(() => useNextTrackDecision({
      activePlaylistId: null,
      hasActivePlaylistContext: false,
      playlistQueueIds: [],
      effectivePlaylistIndex: null,
      temporaryQueue: [],
      currentVideoId: "r1",
      isDockedDesktop: true,
      autoplayEnabled: true,
      routeAutoplayQueueIds: ["r1", "r2"],
      getRandomWatchNextId: randomPicker,
    }));

    expect(result.current.resolveNextTarget()).toEqual({
      videoId: "r2",
      playlistItemIndex: null,
      clearPlaylist: true,
    });
    expect(randomPicker).not.toHaveBeenCalled();
  });

  it("advances active playlist with wrap-around", () => {
    const { result } = renderHook(() => useNextTrackDecision({
      activePlaylistId: "pl-1",
      hasActivePlaylistContext: true,
      playlistQueueIds: ["v1", "v2", "v3"],
      effectivePlaylistIndex: 2,
      temporaryQueue: [],
      currentVideoId: "v3",
      isDockedDesktop: false,
      autoplayEnabled: false,
      routeAutoplayQueueIds: [],
      getRandomWatchNextId: vi.fn(() => "rand"),
    }));

    expect(result.current.resolveNextTarget()).toEqual({
      videoId: "v1",
      playlistItemIndex: 0,
      clearPlaylist: false,
    });
  });

  it("does not fall back to random when playlist is selected but unresolved", () => {
    const randomPicker = vi.fn(() => "rand");

    const { result } = renderHook(() => useNextTrackDecision({
      activePlaylistId: "pl-1",
      hasActivePlaylistContext: false,
      playlistQueueIds: [],
      effectivePlaylistIndex: null,
      temporaryQueue: [],
      currentVideoId: "v1",
      isDockedDesktop: true,
      autoplayEnabled: true,
      routeAutoplayQueueIds: ["r1"],
      getRandomWatchNextId: randomPicker,
    }));

    expect(result.current.resolveNextTarget()).toBeNull();
    expect(randomPicker).not.toHaveBeenCalled();
  });

  it("uses temporary queue next item when current video is queued", () => {
    const queue = [createVideo("q1"), createVideo("q2")];

    const { result } = renderHook(() => useNextTrackDecision({
      activePlaylistId: null,
      hasActivePlaylistContext: false,
      playlistQueueIds: [],
      effectivePlaylistIndex: null,
      temporaryQueue: queue,
      currentVideoId: "q1",
      isDockedDesktop: false,
      autoplayEnabled: false,
      routeAutoplayQueueIds: [],
      getRandomWatchNextId: vi.fn(() => "rand"),
    }));

    expect(result.current.resolveNextTarget()).toEqual({
      videoId: "q2",
      playlistItemIndex: null,
      clearPlaylist: true,
    });
  });

  it("uses temporary queue head when current video is not in queue", () => {
    const queue = [createVideo("q1"), createVideo("q2")];

    const { result } = renderHook(() => useNextTrackDecision({
      activePlaylistId: null,
      hasActivePlaylistContext: false,
      playlistQueueIds: [],
      effectivePlaylistIndex: null,
      temporaryQueue: queue,
      currentVideoId: "other",
      isDockedDesktop: false,
      autoplayEnabled: false,
      routeAutoplayQueueIds: [],
      getRandomWatchNextId: vi.fn(() => "rand"),
    }));

    expect(result.current.resolveNextTarget()).toEqual({
      videoId: "q1",
      playlistItemIndex: null,
      clearPlaylist: true,
    });
  });

  it("uses route autoplay queue progression when docked autoplay is active", () => {
    const { result } = renderHook(() => useNextTrackDecision({
      activePlaylistId: null,
      hasActivePlaylistContext: false,
      playlistQueueIds: [],
      effectivePlaylistIndex: null,
      temporaryQueue: [],
      currentVideoId: "r2",
      isDockedDesktop: true,
      autoplayEnabled: true,
      routeAutoplayQueueIds: ["r1", "r2", "r3"],
      getRandomWatchNextId: vi.fn(() => "rand"),
    }));

    expect(result.current.resolveNextTarget()).toEqual({
      videoId: "r3",
      playlistItemIndex: null,
      clearPlaylist: true,
    });
  });

  it("falls back to random watch-next id when no queue source applies", () => {
    const { result } = renderHook(() => useNextTrackDecision({
      activePlaylistId: null,
      hasActivePlaylistContext: false,
      playlistQueueIds: [],
      effectivePlaylistIndex: null,
      temporaryQueue: [],
      currentVideoId: "v1",
      isDockedDesktop: false,
      autoplayEnabled: false,
      routeAutoplayQueueIds: [],
      getRandomWatchNextId: vi.fn(() => "rand"),
    }));

    expect(result.current.resolveNextTarget()).toEqual({
      videoId: "rand",
      playlistItemIndex: null,
      clearPlaylist: true,
    });
  });
});
