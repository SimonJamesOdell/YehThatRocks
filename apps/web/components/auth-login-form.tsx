"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type BrowserPasswordCredential = {
  id: string;
  password: string;
};

type CredentialsContainerLike = {
  get?: (options?: { password?: boolean; mediation?: "optional" | "required" | "silent" }) => Promise<unknown>;
  store?: (credential: unknown) => Promise<unknown>;
};

function getBrowserCredentialsContainer() {
  return (navigator as Navigator & { credentials?: CredentialsContainerLike }).credentials;
}

const INTRO_SKIP_ONCE_AFTER_LOGIN_KEY = "ytr:intro-skip-once";

export function AuthLoginForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const hasAttemptedAutoLoginRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  async function submitLogin(email: string, password: string) {
    const remember = true;

    if (!email || !password) {
      setError("Please enter your email and password.");
      return false;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password, remember }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Login failed. Please try again.");
        return false;
      }

      const credentials = getBrowserCredentialsContainer();

      if (formRef.current && typeof window !== "undefined" && "PasswordCredential" in window && credentials?.store) {
        try {
          const credential = new (window as unknown as { PasswordCredential: new (form: HTMLFormElement) => Credential }).PasswordCredential(formRef.current);
          await credentials.store(credential);
        } catch {
          // Ignore browser credential storage failures; auth already succeeded.
        }
      }

      const videoParam = new URLSearchParams(window.location.search).get("v");
      const target = videoParam ? `/?v=${encodeURIComponent(videoParam)}` : "/";
      window.sessionStorage.setItem(INTRO_SKIP_ONCE_AFTER_LOGIN_KEY, "1");
      // Use full page reload to ensure cookies are persisted before server components read them
      window.location.href = target;
      return true;
    } catch {
      setError("Unable to reach login service. Please try again.");
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    await submitLogin(email, password);
  }

  useEffect(() => {
    if (hasAttemptedAutoLoginRef.current) {
      return;
    }

    hasAttemptedAutoLoginRef.current = true;

    const credentials = getBrowserCredentialsContainer();
    if (!credentials?.get) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const credential = await credentials.get({
          password: true,
          mediation: "optional",
        });

        if (cancelled || isSubmitting || !credential || typeof credential !== "object") {
          return;
        }

        const candidate = credential as Partial<BrowserPasswordCredential>;
        const email = typeof candidate.id === "string" ? candidate.id.trim() : "";
        const password = typeof candidate.password === "string" ? candidate.password : "";

        if (!email || !password) {
          return;
        }

        if (formRef.current) {
          const emailInput = formRef.current.elements.namedItem("email") as HTMLInputElement | null;
          const passwordInput = formRef.current.elements.namedItem("password") as HTMLInputElement | null;

          if (emailInput) {
            emailInput.value = email;
          }

          if (passwordInput) {
            passwordInput.value = password;
          }
        }

        await submitLogin(email, password);
      } catch {
        // Ignore credential API failures on unsupported or unstable browser implementations.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isSubmitting]);

  return (
    <form ref={formRef} className="authForm" onSubmit={handleSubmit}>
      <label>
        <span>Email or username</span>
        <input name="email" type="text" placeholder="you@example.com or your handle" required autoComplete="username" />
      </label>
      <label className="authPasswordField">
        <span>Password</span>
        <div className="authPasswordInputWrap">
          <input
            name="password"
            type={isPasswordVisible ? "text" : "password"}
            placeholder="••••••••"
            required
            autoComplete="current-password"
          />
          <button
            type="button"
            className="authPasswordToggle"
            aria-label={isPasswordVisible ? "Hide password" : "Show password"}
            title={isPasswordVisible ? "Hide password" : "Show password"}
            aria-pressed={isPasswordVisible}
            onClick={() => setIsPasswordVisible((current) => !current)}
          >
            <span aria-hidden="true">👁</span>
          </button>
        </div>
      </label>
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Logging in..." : "Login"}
      </button>
      {error ? <p className="authMessage">{error}</p> : null}
    </form>
  );
}
