"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useMobilePlayer } from "@/components/mobile/mobile-player-context";
import { MobileYouTubePlayer } from "@/components/mobile/mobile-youtube-player";
import { MobileFavouriteButton } from "@/components/mobile/mobile-favourite-button";
import { MobileVideoList } from "@/components/mobile/mobile-video-card";
import type { MobileVideo } from "@/components/mobile/mobile-player-context";

const NAV_ITEMS = [
  { href: "/m", label: "Home" },
  { href: "/m/new", label: "New" },
  { href: "/m/categories", label: "Categories" },
  { href: "/m/artists", label: "Artists" },
  { href: "/m/top100", label: "Top 100" },
  { href: "/m/favourites", label: "Favourites" },
  { href: "/m/search", label: "Search" },
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

export function MobileShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { player, auth, refreshAuth, stopVideo, openFullscreen, playerApiRef } = useMobilePlayer();
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [relatedVideos, setRelatedVideos] = useState<MobileVideo[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [hasMoreRelated, setHasMoreRelated] = useState(true);
  const [isLoadingMoreRelated, setIsLoadingMoreRelated] = useState(false);
  const relatedOffsetRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const detailsRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setIsNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (isNavOpen && navRef.current && !navRef.current.contains(e.target as Node)) {
        setIsNavOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isNavOpen]);

  useEffect(() => {
    if (!player.video) {
      setRelatedVideos([]);
      setHasMoreRelated(true);
      relatedOffsetRef.current = 0;
      return;
    }

    let cancelled = false;
    setRelatedLoading(true);
    setHasMoreRelated(true);
    relatedOffsetRef.current = 0;

    async function loadRelated() {
      try {
        const res = await fetch(`/api/current-video?v=${encodeURIComponent(player.video!.id)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          const videos: MobileVideo[] = (data.relatedVideos || [])
            .filter((v: MobileVideo) => v.id !== player.video!.id);
          setRelatedVideos(videos);
          relatedOffsetRef.current = videos.length;
          // hasMore is only present for paged requests; assume true for initial batch
          if (typeof data.hasMore === "boolean") {
            setHasMoreRelated(data.hasMore);
          }
        }
      } catch {
        // Silently fail
      } finally {
        if (!cancelled) setRelatedLoading(false);
      }
    }

    loadRelated();
    return () => { cancelled = true; };
  }, [player.video]);

  const loadMoreRelated = useCallback(async () => {
    if (!player.video || !hasMoreRelated || isLoadingMoreRef.current) return;

    isLoadingMoreRef.current = true;
    setIsLoadingMoreRelated(true);
    try {
      const offset = relatedOffsetRef.current;
      const params = new URLSearchParams();
      params.set("v", player.video.id);
      params.set("count", "10");
      params.set("offset", String(offset));

      const res = await fetch(`/api/current-video?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      const newVideos: MobileVideo[] = (data.relatedVideos || [])
        .filter((v: MobileVideo) => v.id !== player.video!.id);

      if (typeof data.hasMore === "boolean") {
        setHasMoreRelated(data.hasMore);
      }

      if (newVideos.length > 0) {
        setRelatedVideos((prev) => {
          const existingIds = new Set(prev.map((v) => v.id));
          const deduped = newVideos.filter((v) => !existingIds.has(v.id));
          relatedOffsetRef.current = prev.length + deduped.length;
          return [...prev, ...deduped];
        });
      } else {
        setHasMoreRelated(false);
      }
    } catch {
      // Silently fail
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMoreRelated(false);
    }
  }, [player.video, hasMoreRelated]);

  const handleDetailsScroll = useCallback(() => {
    if (!player.video || !hasMoreRelated || !player.isFullscreen) return;

    const container = detailsRef.current;
    if (!container) return;

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < 600) {
      void loadMoreRelated();
    }
  }, [player.video, hasMoreRelated, player.isFullscreen, loadMoreRelated]);

  // Auto-load more if the content doesn't fill the scrollable area
  useEffect(() => {
    if (!player.video || !hasMoreRelated || !player.isFullscreen) return;
    if (!detailsRef.current || relatedVideos.length === 0 || relatedLoading) return;

    const container = detailsRef.current;
    // Use requestAnimationFrame so the DOM has settled after render
    const raf = requestAnimationFrame(() => {
      if (container.scrollHeight <= container.clientHeight) {
        void loadMoreRelated();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [player.video, hasMoreRelated, player.isFullscreen, relatedVideos.length, relatedLoading, loadMoreRelated]);

  const isActive = useCallback(
    (href: string) => {
      if (href === "/m") return pathname === "/m";
      return pathname.startsWith(href);
    },
    [pathname],
  );

  const thumbnailUrl = player.video
    ? `https://i.ytimg.com/vi/${encodeURIComponent(player.video.id)}/mqdefault.jpg`
    : null;

  return (
    <div className="mobile-shell">
      <header className="mobile-topbar">
        <button
          type="button"
          className="mobile-hamburger"
          aria-label={isNavOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={isNavOpen}
          onMouseDown={() => setIsNavOpen((prev) => !prev)}
        >
          {isNavOpen ? "\u2715" : "\u2630"}
        </button>

        <Link href="/m" className="mobile-logo-link">
          <span className="mobile-logo-text">YEH THAT ROCKS</span>
        </Link>

        {auth.checked && auth.isLoggedIn ? (
          <Link href="/m/account" className="mobile-account-link" aria-label="Account">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" stroke="none">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4 4-7 8-7s8 3 8 7" />
            </svg>
          </Link>
        ) : (
          <Link href="/m/login" className="mobile-account-link" aria-label="Account">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4 4-7 8-7s8 3 8 7" />
            </svg>
          </Link>
        )}
      </header>

      {isNavOpen && (
        <div className="mobile-nav-overlay" onClick={() => setIsNavOpen(false)} />
      )}

      <nav
        ref={navRef}
        className={`mobile-nav-drawer ${isNavOpen ? "mobile-nav-drawer-open" : ""}`}
        aria-hidden={!isNavOpen}
      >
        <div className="mobile-nav-brand">
          <span className="mobile-nav-brand-text">YEH THAT ROCKS</span>
          {auth.checked && auth.isLoggedIn && auth.screenName && (
            <div className="mobile-nav-user">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none" style={{ opacity: 0.7 }}>
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-4 4-7 8-7s8 3 8 7" />
              </svg>
              <span>{auth.screenName}</span>
            </div>
          )}
        </div>
        <ul className="mobile-nav-list">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`mobile-nav-link ${isActive(item.href) ? "mobile-nav-link-active" : ""}`}
                onClick={() => setIsNavOpen(false)}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mobile-nav-footer">
          {auth.checked && auth.isLoggedIn ? (
            <>
              <Link href="/m/account" className="mobile-nav-link" onClick={() => setIsNavOpen(false)}>
                Account
              </Link>
              <button
                type="button"
                className="mobile-nav-link mobile-nav-logout"
                onClick={() => {
                  fetch("/api/auth/logout", { method: "POST" })
                    .finally(() => {
                      refreshAuth();
                      setIsNavOpen(false);
                      window.location.href = "/m";
                    });
                }}
                style={{ background: "none", border: "none", width: "100%", textAlign: "left", cursor: "pointer", fontSize: "inherit" }}
              >
                Log Out
              </button>
            </>
          ) : (
            <Link href="/m/login" className="mobile-nav-link" onClick={() => setIsNavOpen(false)}>
              Login / Register
            </Link>
          )}
        </div>
      </nav>

      <main className="mobile-content">
        {children}
      </main>

      {player.video && !player.isFullscreen && (
        <div className="mobile-player-bar">
          <button
            type="button"
            className="mobile-player-bar-button"
            onClick={openFullscreen}
          >
            <img
              src={thumbnailUrl!}
              alt=""
              className="mobile-player-bar-thumb"
            />
            <div className="mobile-player-bar-info">
              <p className="mobile-player-bar-title">{player.video.title}</p>
              <p className="mobile-player-bar-artist">{player.video.parsedArtist || player.video.channelTitle}</p>
            </div>
            <div className="mobile-player-bar-controls">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </button>
          <button
            type="button"
            className="mobile-player-bar-close"
            onClick={stopVideo}
            aria-label="Stop"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {player.video && player.isFullscreen && (
        <div className="mobile-player-fullscreen">
          <div className="mobile-player-fullscreen-topbar">
            <button
              type="button"
              className="mobile-player-back"
              onClick={stopVideo}
              aria-label="Close player"
            >
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <div className="mobile-player-fullscreen-info">
              <p className="mobile-player-fullscreen-title">{player.video.title}</p>
              <p className="mobile-player-fullscreen-artist">
                {player.video.parsedArtist || player.video.channelTitle}
              </p>
            </div>
          </div>

          <div className="mobile-player-wrapper">
            <MobileYouTubePlayer
              videoId={player.video.id}
              playerApiRef={playerApiRef}
              onEnd={() => {}}
            />
          </div>

          <div ref={detailsRef} className="mobile-player-details" onScroll={handleDetailsScroll}>
            <div className="mobile-player-meta">
              <Link
                href={`/m/categories/${slugify(player.video.genre)}`}
                className="mobile-player-genre-link"
              >
                <span className="mobile-player-genre-tag">{player.video.genre}</span>
              </Link>
              {player.video.favourited > 0 && (
                <span className="mobile-player-favs">
                  ❤️ {player.video.favourited.toLocaleString()}
                </span>
              )}
              {auth?.isLoggedIn && (
                <MobileFavouriteButton videoId={player.video.id} />
              )}
            </div>

            <div className="mobile-player-related">
              {relatedLoading && relatedVideos.length === 0 && (
                <div className="mobile-loading" style={{ padding: "20px 0" }}>
                  <div className="mobile-loading-spinner" />
                </div>
              )}

              {relatedVideos.length > 0 && (
                <>
                  <p className="mobile-player-related-title">Watch Next</p>
                  <MobileVideoList videos={relatedVideos} />
                </>
              )}

              {!relatedLoading && relatedVideos.length === 0 && (
                <p className="mobile-player-related-empty">No related videos found.</p>
              )}

              {isLoadingMoreRelated && (
                <div className="mobile-loading" style={{ padding: "16px 0" }}>
                  <div className="mobile-loading-spinner" />
                </div>
              )}

              {!hasMoreRelated && relatedVideos.length > 10 && (
                <p className="mobile-player-related-end">— End of Watch Next —</p>
              )}
            </div>
          </div>
        </div>
      )}

      {isNavOpen && <div className="mobile-nav-focus-guard" />}
    </div>
  );
}
