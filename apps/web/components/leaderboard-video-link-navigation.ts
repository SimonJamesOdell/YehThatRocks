export type LeaderboardVideoLinkRowVariant = "default" | "new";

export type LeaderboardVideoLinkNavigationAction =
  | {
      kind: "dispatch-manual-navigation-request";
      videoId: string;
    }
  | {
      kind: "navigate-with-history";
      href: string;
    };

export function resolveLeaderboardVideoLinkNavigationAction({
  rowVariant,
  videoId,
  href,
}: {
  rowVariant: LeaderboardVideoLinkRowVariant;
  videoId: string;
  href: string;
}): LeaderboardVideoLinkNavigationAction {
  if (rowVariant === "new") {
    return {
      kind: "dispatch-manual-navigation-request",
      videoId,
    };
  }

  return {
    kind: "navigate-with-history",
    href,
  };
}