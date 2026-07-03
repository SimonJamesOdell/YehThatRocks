import { MobileVideoList } from "@/components/mobile/mobile-video-card";
import type { MobileVideo } from "@/components/mobile/mobile-player-context";

async function getTopVideos(): Promise<{ videos: MobileVideo[]; error: string | null }> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/videos/top?count=50`, { cache: "no-store" });
    if (!res.ok) return { videos: [], error: "Failed to load videos" };
    const data = await res.json();
    return { videos: data.videos || [], error: null };
  } catch {
    return { videos: [], error: "Failed to load" };
  }
}

export default async function MobileHomePage() {
  const { videos, error } = await getTopVideos();

  return (
    <div>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">Home</h1>
        <p className="mobile-page-subtitle">Top tracks on YehThatRocks</p>
      </div>

      {error ? (
        <div className="mobile-empty-state">
          <p>{error}</p>
        </div>
      ) : (
        <MobileVideoList videos={videos} />
      )}
    </div>
  );
}
