"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MobilePlayerProvider, useMobilePlayer } from "./_components/mobile-player-context";
import { MobileYouTubePlayer } from "./_components/mobile-youtube-player";
import { MobileFavouriteButton } from "./_components/mobile-favourite-button";
import { MobileVideoList } from "./_components/mobile-video-card";
import type { MobileVideo } from "./_components/mobile-player-context";

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

function MobileShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { player, auth, refreshAuth, stopVideo, openFullscreen, playerApiRef } = useMobilePlayer();
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [relatedVideos, setRelatedVideos] = useState<MobileVideo[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
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
      return;
    }

    let cancelled = false;
    setRelatedLoading(true);

    async function loadRelated() {
      try {
        const genreSlug = slugify(player.video!.genre);
        const res = await fetch(`/api/categories/${genreSlug}?limit=12`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          const filtered = (data.videos || []).filter(
            (v: MobileVideo) => v.id !== player.video!.id
          ).slice(0, 10);
          setRelatedVideos(filtered);
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

          <div className="mobile-player-details">
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
              <MobileFavouriteButton videoId={player.video.id} />
            </div>

            <div className="mobile-player-related">
              {relatedLoading && (
                <div className="mobile-loading" style={{ padding: "20px 0" }}>
                  <div className="mobile-loading-spinner" />
                </div>
              )}

              {!relatedLoading && relatedVideos.length > 0 && (
                <>
                  <p className="mobile-player-related-title">More like this</p>
                  <MobileVideoList videos={relatedVideos} />
                </>
              )}

              {!relatedLoading && relatedVideos.length === 0 && (
                <p className="mobile-player-related-empty">No related videos found.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {isNavOpen && <div className="mobile-nav-focus-guard" />}
    </div>
  );
}

export default function MobileLayout({ children }: { children: ReactNode }) {
  return (
    <MobilePlayerProvider>
      <MobileShell>{children}</MobileShell>
    </MobilePlayerProvider>
  );
}
