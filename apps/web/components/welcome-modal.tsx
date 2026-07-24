"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import { getGenreSlug, type GenreCard } from "@/lib/catalog-data-utils";

const WELCOME_DISMISSED_KEY = "ytr:welcome-dismissed";
const GENRE_PREFERENCES_KEY = "ytr:genre-preferences";
const LOGO_SRC = "/assets/images/yeh_main_logo.png?v=20260424-4";

export function WelcomeModal({ onDismissed, isAuthenticated, onOpenAuthModal }: {
  onDismissed?: () => void;
  isAuthenticated?: boolean;
  onOpenAuthModal?: () => void;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [categories, setCategories] = useState<GenreCard[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<Set<string>>(new Set());
  const isAuthenticatedRef = useRef(isAuthenticated ?? false);

  useEffect(() => {
    // Never show if user has explicitly dismissed permanently.
    if (typeof window === "undefined") return;
    if (localStorage.getItem(WELCOME_DISMISSED_KEY) === "1") return;

    let cancelled = false;

    fetch("/api/categories/top-level-cards")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const cards: GenreCard[] = (data.cards || []).filter(
          (card: GenreCard) => card.genre?.trim() !== "Rock / Metal"
        );
        setCategories(cards);
        // Initially all genres are selected.
        setSelectedGenres(new Set(cards.map((card) => card.genre)));
        setIsOpen(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Still show the modal even if categories fail to load.
        setIsOpen(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Keep ref in sync so handleContinue always reads current value.
  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated ?? false;
  }, [isAuthenticated]);

  // Phase 2: show account creation prompt after genre selection.
  const [showAccountPrompt, setShowAccountPrompt] = useState(false);

  const toggleGenre = useCallback((genre: string) => {
    setSelectedGenres((prev) => {
      const next = new Set(prev);
      if (next.has(genre)) {
        next.delete(genre);
      } else {
        next.add(genre);
      }
      return next;
    });
  }, []);

  // Persist genre selections to localStorage.
  const persistGenres = useCallback(() => {
    const genreArray = Array.from(selectedGenres);
    try {
      localStorage.setItem(GENRE_PREFERENCES_KEY, JSON.stringify(genreArray));
    } catch {
      // Best-effort only.
    }
  }, [selectedGenres]);

  // Full dismiss: store permanent dismissal if checked, persist genres, close.
  const handleDismiss = useCallback(() => {
    if (dontShowAgain) {
      localStorage.setItem(WELCOME_DISMISSED_KEY, "1");
    }
    persistGenres();
    setIsOpen(false);
    onDismissed?.();
  }, [dontShowAgain, persistGenres, onDismissed]);

  // Opens the auth modal (which has the proper screen-name selection flow)
  // and dismisses the welcome panel.
  const handleCreateAnonymous = useCallback(() => {
    handleDismiss();
    onOpenAuthModal?.();
  }, [handleDismiss, onOpenAuthModal]);

  // Phase 1 → Phase 2: persist genres. If already authenticated, dismiss;
  // else show account prompt.
  const handleContinue = useCallback(() => {
    persistGenres();
    if (isAuthenticatedRef.current) {
      handleDismiss();
    } else {
      setShowAccountPrompt(true);
    }
  }, [persistGenres, handleDismiss, isAuthenticatedRef]);

  // Skip account creation: just dismiss (genres already persisted in handleContinue).
  const handleSkip = useCallback(() => {
    handleDismiss();
  }, [handleDismiss]);

  // Navigate to registration page; genres are already in localStorage from handleContinue.
  const handleRegister = useCallback(() => {
    router.push("/register");
    handleDismiss();
  }, [router, handleDismiss]);

  // Close on Escape key — use dismiss in both phases.
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (showAccountPrompt) {
          handleDismiss();
        } else {
          handleDismiss();
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, showAccountPrompt, handleDismiss]);

  // Prevent body scroll while modal is open.
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedCount = selectedGenres.size;
  const totalCount = categories.length;

  return (
    <div className="welcomeModal" role="dialog" aria-modal="true" aria-label="Welcome to YehThatRocks">
      {/* Backdrop — dismisses in both phases */}
      <div
        className="welcomeModalBackdrop"
        aria-hidden="true"
        onClick={showAccountPrompt ? handleDismiss : handleDismiss}
      />

      <div className="welcomeModalPanel">
        {/* Header with title, logo and close button */}
        <div className="welcomeModalHeader">
          <div className="welcomeModalHeaderGroup">
            <h2 className="welcomeModalTitle">Welcome To</h2>
            <Image
              src={LOGO_SRC}
              alt="Yeh That Rocks"
              width={306}
              height={93}
              className="welcomeModalLogo"
              priority
              unoptimized
            />
          </div>
          <button
            type="button"
            className="welcomeModalClose"
            onClick={handleDismiss}
            aria-label="Close welcome screen"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        {!showAccountPrompt ? (
          <>
            <div className="welcomeModalBody">
              <p className="welcomeModalBlurb">
                <strong>50,000+ rock and metal tracks</strong> — stream free, no ads ever.
                Browse <strong>8 curated genre buckets</strong> from Classic Metal to Death
                Metal, Punk to Progressive. Discover new videos every day,{" "}
                <strong>build playlists</strong>, save favourites, join the{" "}
                <strong>community chat</strong>, browse the <strong>magazine</strong>, or dive into
                the <strong>forum</strong>.
              </p>

              <p className="welcomeModalPrompt">Select the genres you want to see:</p>

              {categories.length > 0 ? (
                <div className="welcomeModalGrid">
                  {categories.map((card) => {
                    const slug = getGenreSlug(card.genre);
                    const isSelected = selectedGenres.has(card.genre);
                    return (
                      <button
                        key={slug}
                        type="button"
                        className={`welcomeModalCard${isSelected ? "" : " welcomeModalCard--deselected"}`}
                        onClick={() => toggleGenre(card.genre)}
                        aria-pressed={isSelected}
                        aria-label={`${isSelected ? "Deselect" : "Select"} ${card.genre}`}
                      >
                        <span className="welcomeModalCardCheck" aria-hidden="true">
                          {isSelected ? "✓" : ""}
                        </span>
                        {card.previewVideoId ? (
                          <YouTubeThumbnailImage
                            videoId={card.previewVideoId}
                            alt=""
                            className="welcomeModalCardThumb"
                            format="mqdefault"
                            loading="lazy"
                            hideClosestSelector=".welcomeModalCard"
                            reportReason="welcome-modal-thumbnail-load-error"
                          />
                        ) : (
                          <div className="welcomeModalCardThumb" aria-hidden="true" />
                        )}
                        <span className="welcomeModalCardTitle">{card.genre}</span>
                        <span className="welcomeModalCardCount">
                          {card.artistCount.toLocaleString("en-US")} artist{card.artistCount !== 1 ? "s" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {/* Footer — Phase 1 */}
            <div className="welcomeModalFooter">
              <label className="welcomeModalDontShow">
                <input
                  type="checkbox"
                  checked={dontShowAgain}
                  onChange={(event) => setDontShowAgain(event.target.checked)}
                />
                Don&rsquo;t show again
              </label>
              <span className="welcomeModalSelectionCount">
                {selectedCount} of {totalCount} selected
              </span>
              <button
                type="button"
                className="welcomeModalGetStarted"
                onClick={handleContinue}
                disabled={selectedCount === 0}
              >
                Continue
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Phase 2: Account creation prompt */}
            <div className="welcomeModalBody">
              <p className="welcomeModalBlurb">
                <strong>Save your preferences</strong> so your genre selections follow you
                across devices. Create a free account or continue anonymously — either way,
                your picks are applied to auto-play, the new videos page, and your
                watch-next rail.
              </p>
              <div className="welcomeModalAccountOptions">
                <button
                  type="button"
                  className="welcomeModalAccountButton welcomeModalAccountButton--primary"
                  onClick={handleCreateAnonymous}
                >
                  Create Anonymous Account
                </button>
                <button
                  type="button"
                  className="welcomeModalAccountButton welcomeModalAccountButton--secondary"
                  onClick={handleRegister}
                >
                  Register with Email
                </button>
                <button
                  type="button"
                  className="welcomeModalAccountButton welcomeModalAccountButton--ghost"
                  onClick={handleSkip}
                >
                  Skip — save locally only
                </button>
              </div>
            </div>

            {/* Footer — Phase 2 (minimal) */}
            <div className="welcomeModalFooter">
              <label className="welcomeModalDontShow">
                <input
                  type="checkbox"
                  checked={dontShowAgain}
                  onChange={(event) => setDontShowAgain(event.target.checked)}
                />
                Don&rsquo;t show again
              </label>
              <span className="welcomeModalSelectionCount">
                {selectedCount} genre{selectedCount !== 1 ? "s" : ""} selected
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}