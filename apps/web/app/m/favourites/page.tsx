import { cookies } from "next/headers";
import Link from "next/link";
import { MobileFixedScroll } from "@/components/mobile/mobile-fixed-scroll";
import { MobileVideoList } from "@/components/mobile/mobile-video-card";
import type { MobileVideo } from "@/components/mobile/mobile-player-context";

async function getFavourites(): Promise<{ videos: MobileVideo[]; needsAuth: boolean; error: string | null }> {
  try {
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll().map((c) => `${c.name}=${c.value}`).join("; ");

    const baseUrl = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/favourites`, {
      headers: { cookie: allCookies },
      cache: "no-store",
    });

    if (res.status === 401) return { videos: [], needsAuth: true, error: null };
    if (!res.ok) return { videos: [], needsAuth: false, error: "Failed to load favourites" };

    const data = await res.json();
    return { videos: data.favourites || [], needsAuth: false, error: null };
  } catch {
    return { videos: [], needsAuth: false, error: "Failed to load" };
  }
}

export default async function MobileFavouritesPage() {
  const { videos, needsAuth, error } = await getFavourites();

  return (
    <MobileFixedScroll>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">Favourites</h1>
        <p className="mobile-page-subtitle">Your saved tracks</p>
      </div>

      <div className="mobile-results-scroll">
        {needsAuth ? (
          <div className="mobile-empty-state">
            <p>You need to log in to see your favourites.</p>
            <Link href="/m/login" className="mobile-retry-button" style={{ textDecoration: "none", color: "#fff", display: "inline-block" }}>
              Log in
            </Link>
          </div>
        ) : error ? (
          <div className="mobile-empty-state">
            <p>{error}</p>
          </div>
        ) : (
          <MobileVideoList videos={videos} initialFavourited />
        )}
      </div>
    </MobileFixedScroll>
  );
}
