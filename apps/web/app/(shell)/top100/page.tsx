import { Top100VideosLoader } from "@/components/top100-videos-loader";
import { getShellRequestAuthState, getShellRequestVideoState } from "@/lib/shell-request-state";

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
