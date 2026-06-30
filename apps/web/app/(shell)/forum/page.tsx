import { ForumPageContent } from "@/components/forum-page-content";
import { getLatestThreads } from "@/lib/forum-data";
import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";

export const metadata = {
  title: "Forum",
  description: "Community forum for rock and metal discovery, recommendations, and site support.",
};

type ForumPageProps = {
  searchParams: Promise<{ section?: string }>;
};

export default async function ForumPage({ searchParams }: ForumPageProps) {
  const authState = await getCurrentAuthenticatedUserAuthState();
  const isAuthenticated = authState.status === "authenticated";
  const latestThreads = await getLatestThreads(30);
  const { section } = await searchParams;

  return (
    <ForumPageContent
      latestThreads={latestThreads}
      isAuthenticated={isAuthenticated}
      selectedSectionId={section ?? null}
    />
  );
}
