"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthForgotPasswordForm } from "@/components/auth-forgot-password-form";
import { AuthLoginForm } from "@/components/auth-login-form";
import { AuthRegisterForm } from "@/components/auth-register-form";
import { magazineDraftEdition } from "@/lib/magazine-draft";

type AuthGateProps = {
  videoCount: number;
};

function resolveSharedVideoId(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return /^[A-Za-z0-9_-]{11}$/.test(normalized) ? normalized : null;
}

function resolveArticleBackHref(source: string | null, backTo: string | null) {
  if (source !== "article" || !backTo) {
    return null;
  }

  const normalized = backTo.trim();
  if (!normalized.startsWith("/magazine/")) {
    return null;
  }

  return normalized;
}

export function AuthGate({ videoCount }: AuthGateProps) {
  const searchParams = useSearchParams();
  const [view, setView] = useState<"login" | "register" | "forgot-password">("login");
  const [sharedVideoTitle, setSharedVideoTitle] = useState<string | null>(null);
  const formattedCount = videoCount.toLocaleString("en-US");
  const sharedVideoId = resolveSharedVideoId(searchParams.get("v"));
  const articleBackHref = resolveArticleBackHref(searchParams.get("from"), searchParams.get("backTo"));
  const panelClassName = [
    "authGatePanel",
    view === "register" ? "authGatePanelExpanded" : "",
    "authGatePanelWide",
  ].filter(Boolean).join(" ");

  useEffect(() => {
    if (!sharedVideoId) {
      setSharedVideoTitle(null);
      return;
    }

    let cancelled = false;
    const sharedVideoUrl = `https://www.youtube.com/watch?v=${sharedVideoId}`;
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(sharedVideoUrl)}&format=json`;

    void fetch(endpoint)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`oEmbed failed with status ${response.status}`);
        }
        return response.json() as Promise<{ title?: unknown }>;
      })
      .then((payload) => {
        const rawTitle = typeof payload.title === "string" ? payload.title.trim() : "";
        if (!cancelled) {
          setSharedVideoTitle(rawTitle || null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSharedVideoTitle(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sharedVideoId]);

  return (
    <main className="authGateScreen" role="main" aria-label="Sign in to Yeh That Rocks">
      <div className="authGateBackdrop" aria-hidden="true" />

      <div className={panelClassName}>
        <div className="authGateBody authGateBodySplit">
          <div className="authGateFormColumn">
            <h2 className="authGateColumnTitle">Join for Free</h2>
            <p className="authGateLead">
              Sign up to access our catalog of <strong className="authGateCount">{formattedCount}</strong>{" "}videos.
              It&apos;s free, and anonymous accounts get full access instantly.
            </p>

            {view === "login" ? <AuthLoginForm /> : null}

            {view === "register" ? (
              <div className="authGateSubpanel">
                <div className="authGateSubpanelHeader authGateSubpanelHeaderStacked">
                  <button type="button" className="authGateBackButton" onClick={() => setView("login")}>
                    Back to sign in
                  </button>
                  <strong>Create your account</strong>
                </div>
                <AuthRegisterForm />
              </div>
            ) : null}

            {view === "forgot-password" ? (
              <div className="authGateSubpanel">
                <div className="authGateSubpanelHeader authGateSubpanelHeaderStacked">
                  <button type="button" className="authGateBackButton" onClick={() => setView("login")}>
                    Back to sign in
                  </button>
                  <strong>Reset your password</strong>
                </div>
                <AuthForgotPasswordForm />
              </div>
            ) : null}

            <div className="authGateLinks">
              <button type="button" className="authGateLink authGateLinkButton" onClick={() => setView("register")}>
                Create account
              </button>
              <button type="button" className="authGateLink authGateLinkButton" onClick={() => setView("forgot-password")}>
                Forgot password?
              </button>
            </div>
          </div>

          {sharedVideoId ? (
            <section className="authGateVideoPreview" aria-label="Shared video preview">
              {articleBackHref ? (
                <Link href={articleBackHref} className="authGateBackButton authGateArticleReturnButton">
                  Back to article
                </Link>
              ) : null}
              <h3 className="authGateVideoTitle">{sharedVideoTitle ?? "Shared video"}</h3>
              <img
                src={`https://i.ytimg.com/vi/${sharedVideoId}/hqdefault.jpg`}
                alt="Shared video thumbnail"
                className="authGateVideoPreviewImage"
                loading="eager"
              />
              <div className="authGateVideoPreviewCopy">
                <strong>This video is waiting for you.</strong>
                <p>We just need to quickly authenticate you, and the video will be available right away.</p>
              </div>
            </section>
          ) : (
            <section className="authGateMagazine authGateMagazineRail" aria-label="Yeh Magazine preview">
              <div className="authGateMagazineBrand">
                <Image
                  src="/assets/images/yeh_main_logo.png?v=20260424-4"
                  alt="Yeh That Rocks"
                  width={280}
                  height={86}
                  unoptimized
                  className="authGateMagazineLogo"
                />
                <p className="authGateMagazineTagline">The world&apos;s loudest website</p>
              </div>
              <p className="authGateMagazineListTitle">Latest articles</p>
              <div className="authGateMagazineList">
                {magazineDraftEdition.tracks.slice(0, 4).map((track) => (
                  <Link key={track.slug} href={`/magazine/${track.slug}`} className="authGateMagazineItem">
                    <img
                      src={`https://i.ytimg.com/vi/${track.videoId}/mqdefault.jpg`}
                      alt={`${track.artist} - ${track.title} thumbnail`}
                      className="authGateMagazineItemThumb"
                      loading="lazy"
                    />
                    <span className="authGateMagazineItemTitle">{track.artist} - {track.title}</span>
                    <small>{track.genre}</small>
                  </Link>
                ))}
              </div>
              <Link href="/magazine" className="authGateMagazineMoreButton">
                See all...
              </Link>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
