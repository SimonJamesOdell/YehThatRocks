"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthForgotPasswordForm } from "@/components/auth-forgot-password-form";
import { AuthLoginForm } from "@/components/auth-login-form";
import { AuthRegisterForm } from "@/components/auth-register-form";

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

export function AuthGate({ videoCount }: AuthGateProps) {
  const searchParams = useSearchParams();
  const [view, setView] = useState<"login" | "register" | "forgot-password">("login");
  const [sharedVideoTitle, setSharedVideoTitle] = useState<string | null>(null);
  const formattedCount = videoCount.toLocaleString("en-US");
  const sharedVideoId = resolveSharedVideoId(searchParams.get("v"));
  const panelClassName = [
    "authGatePanel",
    view === "register" ? "authGatePanelExpanded" : "",
    sharedVideoId ? "authGatePanelWide" : "",
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
        <div className="authGateBrand">
          <Image
            src="/assets/images/yeh_main_logo.png?v=20260424-4"
            alt="Yeh That Rocks"
            width={306}
            height={93}
            priority
            unoptimized
            className="authGateLogo"
          />
          <p className="authGateTagline">The world&apos;s loudest website</p>
        </div>

        <div className={sharedVideoId ? "authGateBody authGateBodySplit" : "authGateBody"}>
          <div className={sharedVideoId ? "authGateFormColumn" : undefined}>
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
          ) : null}
        </div>
      </div>
    </main>
  );
}
