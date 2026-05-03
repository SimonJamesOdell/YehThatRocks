import type { Metadata } from "next";
import { Top100VideosLoader } from "@/components/top100-videos-loader";
import { getShellRequestAuthState, getShellRequestVideoState } from "@/lib/shell-request-state";

export const metadata: Metadata = {
  title: "Top 100 Rock & Metal Videos | YehThatRocks",
  description: "The 100 most-played rock and metal videos on YehThatRocks, ranked by community streams.",
  alternates: { canonical: "/top100" },
  openGraph: {
    title: "Top 100 Rock & Metal Videos | YehThatRocks",
    description: "The 100 most-played rock and metal videos on YehThatRocks, ranked by community streams.",
    url: "/top100",
    siteName: "YehThatRocks",
    type: "website",
  },
};

export default async function TopHundredPage() {
  const [{ hasAccessToken: isAuthenticated }, { seenVideoIds, hiddenVideoIds }] = await Promise.all([
    getShellRequestAuthState(),
    getShellRequestVideoState(),
  ]);

  return (
    <Top100VideosLoader
      isAuthenticated={isAuthenticated}
      seenVideoIds={Array.from(seenVideoIds)}
      hiddenVideoIds={Array.from(hiddenVideoIds)}
    />
  );
}
