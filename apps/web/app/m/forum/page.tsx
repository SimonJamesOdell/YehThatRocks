import { redirect } from "next/navigation";
import { MobileForumSectionPage } from "@/components/mobile/mobile-forum-section-page";
import { getLatestThreads } from "@/lib/forum-data";
import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";

export const metadata = {
  title: "Forum",
  description: "Community forum for rock and metal discovery, recommendations, and site support.",
};

type ForumPageProps = {
  searchParams: Promise<{ section?: string }>;
};

export default async function MobileForumPage({ searchParams }: ForumPageProps) {
  const { section } = await searchParams;

  // Forum home no longer exists as a standalone page — redirect to
  // the home page with the forum tab open.
  if (!section) {
    redirect("/m?tab=forum");
  }

  const authState = await getCurrentAuthenticatedUserAuthState();
  const isAuthenticated = authState.status === "authenticated";
  const latestThreads = await getLatestThreads(30);

  return (
    <MobileForumSectionPage
      latestThreads={latestThreads}
      isAuthenticated={isAuthenticated}
      selectedSectionId={section}
    />
  );
}
