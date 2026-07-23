"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import { getGenreSlug, type GenreCard } from "@/lib/catalog-data-utils";

const WELCOME_DISMISSED_KEY = "ytr:welcome-dismissed";
const LOGO_SRC = "/assets/images/yeh_main_logo.png?v=20260424-4";

export function WelcomeModal({ onDismissed }: { onDismissed?: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [categories, setCategories] = useState<GenreCard[]>([]);

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

  const handleClose = useCallback(() => {
    if (dontShowAgain) {
      localStorage.setItem(WELCOME_DISMISSED_KEY, "1");
    }
    setIsOpen(false);
    onDismissed?.();
  }, [dontShowAgain, onDismissed]);

  // Close on Escape key.
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        handleClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

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

  return (
    <div className="welcomeModal" role="dialog" aria-modal="true" aria-label="Welcome to YehThatRocks">
      {/* Backdrop */}
      <div
        className="welcomeModalBackdrop"
        aria-hidden="true"
        onClick={handleClose}
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
            onClick={handleClose}
            aria-label="Close welcome screen"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="welcomeModalBody">
          <p className="welcomeModalBlurb">
            <strong>50,000+ rock and metal tracks</strong> — stream free, no ads ever.
            Browse <strong>8 curated genre buckets</strong> from Classic Metal to Death
            Metal, Punk to Progressive. Discover new videos every day,{" "}
            <strong>build playlists</strong>, save favourites, join the{" "}
            <strong>community chat</strong>, browse the <strong>magazine</strong>, or dive into
            the <strong>forum</strong>.
          </p>

          {categories.length > 0 ? (
            <div className="welcomeModalGrid">
                {categories.map((card) => {
                  const slug = getGenreSlug(card.genre);
                  return (
                    <Link
                      key={slug}
                      href={`/categories/${encodeURIComponent(slug)}`}
                      className="welcomeModalCard"
                      onClick={handleClose}
                    >
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
                    </Link>
                  );
                })}
              </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="welcomeModalFooter">
          <label className="welcomeModalDontShow">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(event) => setDontShowAgain(event.target.checked)}
            />
            Don&rsquo;t show again
          </label>
          <button
            type="button"
            className="welcomeModalGetStarted"
            onClick={handleClose}
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}
