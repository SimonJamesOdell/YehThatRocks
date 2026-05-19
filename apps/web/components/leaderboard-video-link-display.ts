import type { LeaderboardVideoLinkRowVariant } from "@/components/leaderboard-video-link-navigation";

export function shouldShowLeaderboardVideoArtistCount(rowVariant: LeaderboardVideoLinkRowVariant): boolean {
  return rowVariant !== "new";
}