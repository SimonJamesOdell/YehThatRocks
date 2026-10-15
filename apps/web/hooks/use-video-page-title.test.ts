import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useVideoPageTitle } from "@/hooks/use-video-page-title";
import type { VideoRecord } from "@/lib/catalog";

function makeVideo(
  id: string,
  fields: { title: string; artist?: string; track?: string } = { title: "Track" },
): VideoRecord {
  const artist = fields.artist ?? "Artist";
  const track = fields.track ?? "Track";
  return {
    id,
    title: fields.title,
    channelTitle: artist,
    parsedArtist: artist,
    parsedTrack: track,
    genre: "Rock",
    favourited: 0,
    description: "",
  };
}

function expectedTitle(artist: string, track: string) {
  return `${artist} - ${track} | YehThatRocks`;
}

describe("useVideoPageTitle", () => {
  beforeEach(() => {
    document.title = "";
  });

  it("writes the derived artist-track title when no video id is requested", () => {
    const { rerender } = renderHook(
      ({ video, requested }) => useVideoPageTitle(video, requested),
      {
        initialProps: {
          video: makeVideo("abc", {
            title: "Artist A - Track A (Official)",
            artist: "Artist A",
            track: "Track A",
          }),
          requested: null as string | null,
        },
      },
    );

    expect(document.title).toBe(expectedTitle("Artist A", "Track A"));

    rerender({
      video: makeVideo("def", { title: "Artist B - Track B", artist: "Artist B", track: "Track B" }),
      requested: null,
    });
    expect(document.title).toBe(expectedTitle("Artist B", "Track B"));
  });

  it("writes the title once currentVideo matches the requested video id", () => {
    const requested = "xyz";
    const { rerender } = renderHook(
      ({ video }) => useVideoPageTitle(video, requested),
      {
        initialProps: {
          video: makeVideo("xyz", { title: "Artist X - Track X", artist: "Artist X", track: "Track X" }),
        },
      },
    );

    expect(document.title).toBe(expectedTitle("Artist X", "Track X"));

    // A corrected track for the same video must still sync the tab.
    rerender({
      video: makeVideo("xyz", {
        title: "Artist X - Track X (Updated)",
        artist: "Artist X",
        track: "Track X (Updated)",
      }),
    });
    expect(document.title).toBe(expectedTitle("Artist X", "Track X (Updated)"));
  });

  it("preserves the server-rendered title while currentVideo is a fallback for a different requested id", () => {
    // Simulate the server having already rendered the correct title for ?v=xyz.
    document.title = expectedTitle("Artist X", "Track X");

    const { rerender } = renderHook(
      ({ video }) => useVideoPageTitle(video, "xyz"),
      {
        // The shell layout fell back to a random video while ?v=xyz is requested.
        initialProps: {
          video: makeVideo("random-fallback", {
            title: "Random Track",
            artist: "Random Artist",
            track: "Random Track",
          }),
        },
      },
    );

    // Must not stamp the fallback track's name into the tab.
    expect(document.title).toBe(expectedTitle("Artist X", "Track X"));

    // Once currentVideo catches up to the requested id, the title is synced.
    rerender({
      video: makeVideo("xyz", { title: "Artist X - Track X", artist: "Artist X", track: "Track X" }),
    });
    expect(document.title).toBe(expectedTitle("Artist X", "Track X"));
  });

  it("does not re-write the title when the computed title is unchanged", () => {
    let titleValue = "";
    let writes = 0;
    const originalDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "title");

    Object.defineProperty(Document.prototype, "title", {
      configurable: true,
      get() {
        return titleValue;
      },
      set(value: string) {
        titleValue = value;
        writes += 1;
      },
    });

    try {
      const video = makeVideo("abc", { title: "Artist A - Track A", artist: "Artist A", track: "Track A" });
      const { rerender } = renderHook(() => useVideoPageTitle(video, "abc"));
      rerender();
      expect(writes).toBe(1);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(Document.prototype, "title", originalDescriptor);
      } else {
        delete (Document.prototype as { title?: unknown }).title;
      }
    }
  });
});
