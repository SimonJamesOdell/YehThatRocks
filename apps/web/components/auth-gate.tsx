"use client";

import Image from "next/image";
import { useState } from "react";

import { AuthForgotPasswordForm } from "@/components/auth-forgot-password-form";
import { AuthLoginForm } from "@/components/auth-login-form";
import { AuthRegisterForm } from "@/components/auth-register-form";

type AuthGateProps = {
  videoCount: number;
};

export function AuthGate({ videoCount }: AuthGateProps) {
  const [view, setView] = useState<"login" | "register" | "forgot-password">("login");
  const formattedCount = videoCount.toLocaleString("en-US");
  const panelClassName = view === "register" ? "authGatePanel authGatePanelExpanded" : "authGatePanel";

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

        <div className="authGateBody">
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
      </div>
    </main>
  );
}
