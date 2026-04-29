"use client";

import { useEffect, useState } from "react";

import { AuthLoginForm } from "@/components/auth-login-form";
import { AuthRegisterForm } from "@/components/auth-register-form";
import { AuthForgotPasswordForm } from "@/components/auth-forgot-password-form";

type AuthModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [view, setView] = useState<"login" | "register" | "forgot-password">("login");

  // Reset to login view each time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setView("login");
    }
  }, [isOpen]);

  // Close on Escape key.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

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

  if (!isOpen) {
    return null;
  }

  return (
    <div className="authModal" role="dialog" aria-modal="true" aria-label="Sign in to Yeh That Rocks">
      {/* Backdrop */}
      <div
        className="authModalBackdrop"
        aria-hidden="true"
        onClick={onClose}
      />

      <div className="authModalPanel">
        <div className="authModalHeader">
          <span className="authModalTitle">
            {view === "register" ? "Create account" : view === "forgot-password" ? "Reset password" : "Sign in"}
          </span>
          <button
            type="button"
            className="authModalClose"
            onClick={onClose}
            aria-label="Close sign in"
          >
            ✕
          </button>
        </div>

        <div className="authModalBody">
          {view === "login" ? (
            <>
              <AuthLoginForm />
              <div className="authModalLinks">
                <button
                  type="button"
                  className="authGateLink authGateLinkButton"
                  onClick={() => setView("register")}
                >
                  Create account
                </button>
                <button
                  type="button"
                  className="authGateLink authGateLinkButton"
                  onClick={() => setView("forgot-password")}
                >
                  Forgot password?
                </button>
              </div>
            </>
          ) : view === "register" ? (
            <>
              <button
                type="button"
                className="authGateBackButton"
                onClick={() => setView("login")}
              >
                Back to sign in
              </button>
              <AuthRegisterForm />
            </>
          ) : (
            <>
              <button
                type="button"
                className="authGateBackButton"
                onClick={() => setView("login")}
              >
                Back to sign in
              </button>
              <AuthForgotPasswordForm />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
