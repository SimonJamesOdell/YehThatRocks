import { MobileFixedScroll } from "@/components/mobile/mobile-fixed-scroll";
import { MobileVideoList } from "@/components/mobile/mobile-video-card";
import type { MobileVideo } from "@/components/mobile/mobile-player-context";

async function getTopVideos(): Promise<{ videos: MobileVideo[]; error: string | null }> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/videos/top?count=100`, { cache: "no-store" });
    if (!res.ok) return { videos: [], error: "Failed to load" };
    const data = await res.json();
    return { videos: data.videos || [], error: null };
  } catch {
    return { videos: [], error: "Failed to load" };
  }
}

export default async function MobileTop100Page() {
  const { videos, error } = await getTopVideos();

  return (
    <MobileFixedScroll>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">Top 100</h1>
        <p className="mobile-page-subtitle">Most played tracks</p>
      </div>

      <div className="mobile-results-scroll">
        {error ? (
          <div className="mobile-empty-state">
            <p>{error}</p>
          </div>
        ) : (
          <MobileVideoList videos={videos} />
        )}
      </div>
    </MobileFixedScroll>
  );
}
