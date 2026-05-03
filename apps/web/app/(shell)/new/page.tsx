import type { Metadata } from "next";
import { NewVideosLoader } from "@/components/new-videos-loader";
import { getShellRequestAuthState, getShellRequestVideoState } from "@/lib/shell-request-state";

export const metadata: Metadata = {
  title: "New Rock & Metal Videos | YehThatRocks",
  description: "The latest rock and metal music videos added to YehThatRocks. Fresh drops from across the genre spectrum.",
  alternates: { canonical: "/new" },
  openGraph: {
    title: "New Rock & Metal Videos | YehThatRocks",
    description: "The latest rock and metal music videos added to YehThatRocks.",
    url: "/new",
    siteName: "YehThatRocks",
    type: "website",
  },
};

export default async function NewPage() {
  const [{ hasAccessToken: isAuthenticated, isAdmin: isAdminUser }, { seenVideoIds, hiddenVideoIds }] = await Promise.all([
    getShellRequestAuthState(),
    getShellRequestVideoState(),
  ]);

  return (
    <NewVideosLoader
      initialVideos={[]}
      isAuthenticated={isAuthenticated}
      isAdminUser={isAdminUser}
      seenVideoIds={Array.from(seenVideoIds)}
      hiddenVideoIds={Array.from(hiddenVideoIds)}
    />
  );
}