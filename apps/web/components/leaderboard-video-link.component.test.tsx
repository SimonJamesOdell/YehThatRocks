import React from "react";
import { describe, expect, it } from "vitest";

import { shouldShowLeaderboardVideoArtistCount } from "@/components/leaderboard-video-link-display";
import { resolveLeaderboardVideoLinkNavigationAction } from "@/components/leaderboard-video-link-navigation";

describe("resolveLeaderboardVideoLinkNavigationAction", () => {
  it("requests manual navigation for New rows", () => {
    expect(
      resolveLeaderboardVideoLinkNavigationAction({
        rowVariant: "new",
        videoId: "video-1",
        href: "/?v=video-1&resume=1",
      }),
    ).toEqual({
      kind: "dispatch-manual-navigation-request",
      videoId: "video-1",
    });
  });

  it("keeps default rows on the history-based navigation path", () => {
    expect(
      resolveLeaderboardVideoLinkNavigationAction({
        rowVariant: "default",
        videoId: "video-1",
        href: "/?v=video-1&resume=1",
      }),
    ).toEqual({
      kind: "navigate-with-history",
      href: "/?v=video-1&resume=1",
    });
  });
});

describe("shouldShowLeaderboardVideoArtistCount", () => {
  it("hides artist counts on New rows", () => {
    expect(shouldShowLeaderboardVideoArtistCount("new")).toBe(false);
  });

  it("shows artist counts on default rows", () => {
    expect(shouldShowLeaderboardVideoArtistCount("default")).toBe(true);
  });
});