import { NewVideosLoader } from "@/components/new-videos-loader";
import { getShellRequestAuthState, getShellRequestVideoState } from "@/lib/shell-request-state";

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