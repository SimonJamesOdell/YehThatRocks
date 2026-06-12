import { ForumPageContent } from "@/components/forum-page-content";
import { getLatestThreads } from "@/lib/forum-data";
import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";

export const metadata = {
  title: "Forum",
  description: "Community forum for rock and metal discovery, recommendations, and site support.",
};

export default async function ForumPage() {
  const authState = await getCurrentAuthenticatedUserAuthState();
  const isAuthenticated = authState.status === "authenticated";
  const latestThreads = await getLatestThreads(30);

  return (
    <ForumPageContent latestThreads={latestThreads} isAuthenticated={isAuthenticated} />
  );
}
