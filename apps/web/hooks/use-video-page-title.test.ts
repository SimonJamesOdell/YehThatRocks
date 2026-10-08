import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useVideoPageTitle } from "@/hooks/use-video-page-title";
import type { VideoRecord } from "@/lib/catalog";

function makeVideo(id: string, title: string): VideoRecord {
  return {
    id,
    title,
    channelTitle: "Some Artist",
    genre: "Rock",
    favourited: 0,
    description: "",
  };
}

describe("useVideoPageTitle", () => {
  beforeEach(() => {
    document.title = "";
  });

  it("writes the current video title when no video id is requested", () => {
    const { rerender } = renderHook(
      ({ video, requested }) => useVideoPageTitle(video, requested),
      { initialProps: { video: makeVideo("abc", "Track A"), requested: null as string | null } },
    );

    expect(document.title).toBe("Track A | YehThatRocks");

    rerender({ video: makeVideo("def", "Track B"), requested: null });
    expect(document.title).toBe("Track B | YehThatRocks");
  });

  it("writes the title once currentVideo matches the requested video id", () => {
    const requested = "xyz";
    const { rerender } = renderHook(
      ({ video }) => useVideoPageTitle(video, requested),
      {
        initialProps: { video: makeVideo("xyz", "Track X") },
      },
    );

    expect(document.title).toBe("Track X | YehThatRocks");

    rerender({ video: makeVideo("xyz", "Track X (Updated)") });
    expect(document.title).toBe("Track X | YehThatRocks");
  });

  it("preserves the server-rendered title while currentVideo is a fallback for a different requested id", () => {
    // Simulate the server having already rendered the correct title for ?v=xyz.
    document.title = "Track X | YehThatRocks";

    const { rerender } = renderHook(
      ({ video }) => useVideoPageTitle(video, "xyz"),
      {
        // The shell layout fell back to a random video while ?v=xyz is requested.
        initialProps: { video: makeVideo("random-fallback", "Random Track") },
      },
    );

    // Must not stamp the fallback track's name into the tab.
    expect(document.title).toBe("Track X | YehThatRocks");

    // Once currentVideo catches up to the requested id, the title is synced.
    rerender({ video: makeVideo("xyz", "Track X") });
    expect(document.title).toBe("Track X | YehThatRocks");
  });

  it("does not re-write the title for the same video id", () => {
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
      const video = makeVideo("abc", "Track A");
      const { rerender } = renderHook(
        () => useVideoPageTitle(video, "abc"),
      );
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
