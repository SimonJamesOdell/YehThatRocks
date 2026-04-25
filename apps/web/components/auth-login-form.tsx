"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AnonymousCredentialsModal } from "@/components/anonymous-credentials-modal";

type BrowserPasswordCredential = {
  id: string;
  password: string;
};

type AnonymousAvailabilityResponse = {
  ok?: boolean;
  error?: string;
  available?: boolean;
  screenName?: string;
};

type AnonymousCreateResponse = {
  error?: string;
  credentials?: {
    username: string;
    password: string;
  };
};

type CredentialsContainerLike = {
  get?: (options?: { password?: boolean; mediation?: "optional" | "required" | "silent" }) => Promise<unknown>;
  store?: (credential: unknown) => Promise<unknown>;
};

function getBrowserCredentialsContainer() {
  return (navigator as Navigator & { credentials?: CredentialsContainerLike }).credentials;
}

function canStoreBrowserCredential() {
  if (typeof window === "undefined") {
    return false;
  }

  const credentials = getBrowserCredentialsContainer();
  return "PasswordCredential" in window && typeof credentials?.store === "function";
}

const INTRO_SKIP_ONCE_AFTER_LOGIN_KEY = "ytr:intro-skip-once";
const AUTO_LOGIN_SUPPRESS_ONCE_KEY = "ytr:auto-login-suppress-once";
const ANONYMOUS_SCREEN_NAME_MIN_LENGTH = 2;
const ANONYMOUS_SCREEN_NAME_MAX_LENGTH = 40;
const ANONYMOUS_SUGGESTION_TIMEOUT_MS = 4000;
const ANONYMOUS_SUGGESTION_PREFIXES = ["Metal", "Riff", "Iron", "Neon", "Storm", "Night", "Echo", "Steel"];
const ANONYMOUS_SUGGESTION_SUFFIXES = ["Wolf", "Rider", "Fury", "Howl", "Blade", "Pulse", "Flame", "Static"];

function buildFallbackAnonymousSuggestion() {
  const prefix = ANONYMOUS_SUGGESTION_PREFIXES[Math.floor(Math.random() * ANONYMOUS_SUGGESTION_PREFIXES.length)] ?? "Metal";
  const suffix = ANONYMOUS_SUGGESTION_SUFFIXES[Math.floor(Math.random() * ANONYMOUS_SUGGESTION_SUFFIXES.length)] ?? "Wolf";
  const num = Math.floor(100 + Math.random() * 900);
  return `${prefix}${suffix}${num}`;
}

function consumeAutoLoginSuppressionOnce() {
  if (typeof window === "undefined") {
    return false;
  }

  const shouldSuppress = window.sessionStorage.getItem(AUTO_LOGIN_SUPPRESS_ONCE_KEY) === "1";

  if (shouldSuppress) {
    window.sessionStorage.removeItem(AUTO_LOGIN_SUPPRESS_ONCE_KEY);
  }

  return shouldSuppress;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function markIntroSkipOnceForLegacyInvariant() {
  window.sessionStorage.setItem(INTRO_SKIP_ONCE_AFTER_LOGIN_KEY, "1");
}

export function AuthLoginForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const hasAttemptedAutoLoginRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAnonymousSubmitting, setIsAnonymousSubmitting] = useState(false);
  const [isAnonymousPreparing, setIsAnonymousPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isAnonymousFlowOpen, setIsAnonymousFlowOpen] = useState(false);
  const [anonymousScreenName, setAnonymousScreenName] = useState("");
  const [anonymousSuggestedScreenName, setAnonymousSuggestedScreenName] = useState("");
  const [shouldClearAnonymousSuggestion, setShouldClearAnonymousSuggestion] = useState(false);
  const [anonymousError, setAnonymousError] = useState<string | null>(null);
  const [anonymousAvailability, setAnonymousAvailability] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  const [anonymousCredentials, setAnonymousCredentials] = useState<{ username: string; password: string } | null>(null);
  const [isAnonymousCredentialsContinuePending, setIsAnonymousCredentialsContinuePending] = useState(false);

  function redirectAfterAuth() {
    const videoParam = new URLSearchParams(window.location.search).get("v");
    const target = videoParam ? `/?v=${encodeURIComponent(videoParam)}` : "/";
    window.location.href = target;
  }

  async function storeBrowserCredential(username: string, password: string) {
    const credentials = getBrowserCredentialsContainer();
    if (typeof window === "undefined" || !("PasswordCredential" in window) || !credentials?.store) {
      return;
    }

    try {
      const PasswordCredentialCtor = (window as typeof window & {
        PasswordCredential?: new (data: { id: string; password: string; name?: string }) => Credential;
      }).PasswordCredential;

      if (!PasswordCredentialCtor) {
        return;
      }

      const credential = new PasswordCredentialCtor({
        id: username,
        password,
        name: username,
      });
      await credentials.store(credential);
    } catch {
      if (!formRef.current) {
        return;
      }

      const usernameInput = formRef.current.elements.namedItem("email") as HTMLInputElement | null;
      const passwordInput = formRef.current.elements.namedItem("password") as HTMLInputElement | null;

      if (!usernameInput || !passwordInput) {
        return;
      }

      usernameInput.value = username;
      passwordInput.value = password;

      try {
        const FormPasswordCredentialCtor = (window as typeof window & {
          PasswordCredential?: new (form: HTMLFormElement) => Credential;
        }).PasswordCredential;

        if (!FormPasswordCredentialCtor) {
          return;
        }

        const credential = new FormPasswordCredentialCtor(formRef.current);
        await credentials.store(credential);
      } catch {
        // Ignore browser credential storage failures; auth already succeeded.
      }
    }
  }

  async function submitLogin(
    email: string,
    password: string,
    options?: {
      redirectOnSuccess?: boolean;
      storeCredentialOnSuccess?: boolean;
    },
  ) {
    const remember = true;
    const shouldRedirect = options?.redirectOnSuccess ?? true;
    const shouldStoreCredential = options?.storeCredentialOnSuccess ?? true;

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

      if (shouldStoreCredential) {
        await storeBrowserCredential(email, password);
      }

      if (shouldRedirect) {
        redirectAfterAuth();
      }

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

  async function checkAnonymousScreenNameAvailability(screenName: string) {
    const response = await fetchWithTimeout(`/api/auth/anonymous?screenName=${encodeURIComponent(screenName)}`, {
      method: "GET",
      cache: "no-store",
    }, ANONYMOUS_SUGGESTION_TIMEOUT_MS);

    const payload = (await response.json().catch(() => null)) as AnonymousAvailabilityResponse | null;

    return {
      ok: response.ok,
      available: payload?.available === true,
      error: payload?.error,
    };
  }

  async function assignAvailableAnonymousSuggestion() {
    setAnonymousAvailability("checking");

    try {
      const response = await fetchWithTimeout("/api/auth/anonymous", {
        method: "GET",
        cache: "no-store",
      }, ANONYMOUS_SUGGESTION_TIMEOUT_MS);

      const payload = (await response.json().catch(() => null)) as AnonymousAvailabilityResponse | null;

      if (!response.ok || !payload?.screenName) {
        setAnonymousAvailability("idle");
        setAnonymousError(payload?.error ?? "Could not find an available screen name right now. Please enter your own.");
        return;
      }

      setAnonymousSuggestedScreenName(payload.screenName);
      setAnonymousScreenName(payload.screenName);
      setShouldClearAnonymousSuggestion(true);
      setAnonymousAvailability("available");
      return;
    } catch {
      // Fall through to compatibility fallback.
    }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const candidate = buildFallbackAnonymousSuggestion();

      try {
        const result = await checkAnonymousScreenNameAvailability(candidate);

        if (!result.ok) {
          continue;
        }

        if (result.available) {
          setAnonymousSuggestedScreenName(candidate);
          setAnonymousScreenName(candidate);
          setShouldClearAnonymousSuggestion(true);
          setAnonymousAvailability("available");
          return;
        }
      } catch {
        continue;
      }
    }

    setAnonymousAvailability("idle");
    setAnonymousError("Could not find an available screen name right now. Please enter your own.");
  }

  async function handleAnonymousEntry() {
    setError(null);
    setAnonymousError(null);
    setIsAnonymousPreparing(true);

    const skipAutoLogin = consumeAutoLoginSuppressionOnce();

    if (skipAutoLogin) {
      setAnonymousScreenName("");
      setAnonymousSuggestedScreenName("");
      setShouldClearAnonymousSuggestion(false);
      setAnonymousAvailability("idle");

      try {
        await assignAvailableAnonymousSuggestion();
      } finally {
        setIsAnonymousFlowOpen(true);
      }

      setIsAnonymousPreparing(false);
      return;
    }

    setAnonymousScreenName("");
    setAnonymousSuggestedScreenName("");
    setShouldClearAnonymousSuggestion(false);
    setAnonymousAvailability("idle");

    try {
      await assignAvailableAnonymousSuggestion();
    } finally {
      setIsAnonymousFlowOpen(true);
    }

    setIsAnonymousPreparing(false);
  }

  async function handleAnonymousCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const screenName = anonymousScreenName.trim();

    if (screenName.length < ANONYMOUS_SCREEN_NAME_MIN_LENGTH || screenName.length > ANONYMOUS_SCREEN_NAME_MAX_LENGTH) {
      setAnonymousError(`Screen name must be between ${ANONYMOUS_SCREEN_NAME_MIN_LENGTH} and ${ANONYMOUS_SCREEN_NAME_MAX_LENGTH} characters.`);
      setAnonymousAvailability("invalid");
      return;
    }

    setAnonymousError(null);
    setIsAnonymousSubmitting(true);

    try {
      const response = await fetch("/api/auth/anonymous", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ screenName }),
      });

      const payload = (await response.json().catch(() => null)) as AnonymousCreateResponse | null;

      if (!response.ok || !payload?.credentials) {
        setAnonymousAvailability(response.status === 409 ? "taken" : anonymousAvailability);
        setAnonymousError(payload?.error ?? "Could not create anonymous account.");
        return;
      }

      if (typeof window !== "undefined") {
        window.localStorage.setItem("ytr:anonymous-username", payload.credentials.username);
      }

      setIsAnonymousFlowOpen(false);
      setAnonymousCredentials(payload.credentials);
    } catch {
      setAnonymousError("Could not create anonymous account.");
    } finally {
      setIsAnonymousSubmitting(false);
    }
  }

  useEffect(() => {
    if (hasAttemptedAutoLoginRef.current) {
      return;
    }

    hasAttemptedAutoLoginRef.current = true;

    const skipAutoLogin = consumeAutoLoginSuppressionOnce();
    if (skipAutoLogin) {
      return;
    }

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

  useEffect(() => {
    if (!isAnonymousFlowOpen) {
      return;
    }

    const screenName = anonymousScreenName.trim();

    if (screenName.length === 0) {
      setAnonymousAvailability("idle");
      return;
    }

    if (screenName.length < ANONYMOUS_SCREEN_NAME_MIN_LENGTH || screenName.length > ANONYMOUS_SCREEN_NAME_MAX_LENGTH) {
      setAnonymousAvailability("invalid");
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setAnonymousAvailability("checking");

      try {
        const payload = await checkAnonymousScreenNameAvailability(screenName);

        if (cancelled) {
          return;
        }

        if (!payload.ok) {
          setAnonymousAvailability("invalid");
          if (payload.error) {
            setAnonymousError(payload.error);
          }
          return;
        }

        setAnonymousAvailability(payload.available ? "available" : "taken");
      } catch {
        if (!cancelled) {
          setAnonymousAvailability("idle");
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [anonymousScreenName, isAnonymousFlowOpen]);

  useEffect(() => {
    if (anonymousCredentials) {
      setIsAnonymousFlowOpen(false);
    }
  }, [anonymousCredentials]);

  const isBusy = isSubmitting || isAnonymousSubmitting || isAnonymousPreparing;
  const canBrowserSaveAnonymousCredentials = canStoreBrowserCredential();

  async function hasAuthenticatedSession() {
    try {
      const response = await fetch("/api/auth/me", {
        method: "GET",
        cache: "no-store",
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function handleAnonymousCredentialsContinue() {
    if (!anonymousCredentials || isAnonymousCredentialsContinuePending) {
      return;
    }

    setError(null);
    setIsAnonymousCredentialsContinuePending(true);

    try {
      if (canBrowserSaveAnonymousCredentials) {
        await storeBrowserCredential(anonymousCredentials.username, anonymousCredentials.password);
      }

      let authenticated = await hasAuthenticatedSession();

      if (!authenticated) {
        authenticated = await submitLogin(anonymousCredentials.username, anonymousCredentials.password, {
          redirectOnSuccess: false,
          storeCredentialOnSuccess: false,
        });
      }

      if (!authenticated) {
        setError("Could not finalize sign-in in this browser mode. Please log in using your saved credentials.");
        return;
      }

      setAnonymousCredentials(null);
      router.refresh();
      redirectAfterAuth();
    } finally {
      setIsAnonymousCredentialsContinuePending(false);
    }
  }

  return (
    <>
      <div className="authChoiceStack">
        <button type="button" className="authSecondaryAction" onClick={handleAnonymousEntry} disabled={isBusy}>
          {isAnonymousPreparing ? "Preparing anonymous login..." : "Login Anonymously ( 2 clicks... )"}
        </button>
        <p className="authSupportCopy">
          Anonymous accounts get the same site access, but password recovery stays disabled until you attach an email later.
        </p>
      </div>

      {isAnonymousFlowOpen && !anonymousCredentials ? (
        <div
          className="authModalOverlay"
          role="presentation"
          onClick={() => {
            if (!isAnonymousSubmitting) {
              setIsAnonymousFlowOpen(false);
            }
          }}
        >
          <div
            className="authModalCard"
            role="dialog"
            aria-modal="true"
            aria-labelledby="anonymous-screen-name-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="authModalHeader">
              <div className="authModalHeaderCopy">
                <p className="authModalEyebrow">Anonymous login</p>
                <h2 id="anonymous-screen-name-title" className="authModalTitle">Choose your screen name</h2>
                <p className="authModalLead">
                  Jump straight in now, with full member features, add recovery later only if you want it.
                </p>
              </div>
              <button
                type="button"
                className="authModalClose"
                aria-label="Close anonymous login"
                onClick={() => setIsAnonymousFlowOpen(false)}
                disabled={isAnonymousSubmitting}
              >
                ×
              </button>
            </div>

            <form className="authForm anonymousAuthForm" onSubmit={handleAnonymousCreate}>
              <label>
                <span>Screen name</span>
                <input
                  name="anonymousScreenName"
                  type="text"
                  value={anonymousScreenName}
                  onClick={() => {
                    if (shouldClearAnonymousSuggestion && anonymousScreenName === anonymousSuggestedScreenName) {
                      setAnonymousScreenName("");
                      setAnonymousAvailability("idle");
                      setShouldClearAnonymousSuggestion(false);
                    }
                  }}
                  onChange={(event) => {
                    setAnonymousScreenName(event.currentTarget.value);
                    setAnonymousError(null);
                    setShouldClearAnonymousSuggestion(false);
                  }}
                  placeholder={anonymousSuggestedScreenName || "MetalFan204"}
                  minLength={ANONYMOUS_SCREEN_NAME_MIN_LENGTH}
                  maxLength={ANONYMOUS_SCREEN_NAME_MAX_LENGTH}
                  autoComplete="nickname"
                  required
                />
              </label>
              <div className="authModalMetaRow">
                <p className="authSupportCopy authModalCopy">
                  Pick something memorable. You can attach an email later to turn on password recovery.
                </p>
                <span className="authModalLengthHint">
                  {ANONYMOUS_SCREEN_NAME_MIN_LENGTH}-{ANONYMOUS_SCREEN_NAME_MAX_LENGTH} chars
                </span>
              </div>
              <p className={`authAvailability authAvailability${anonymousAvailability[0]?.toUpperCase() ?? "I"}${anonymousAvailability.slice(1)}`} aria-live="polite" role="status">
                {anonymousAvailability === "checking" ? "Checking availability..." : null}
                {anonymousAvailability === "available" ? "Screen name available." : null}
                {anonymousAvailability === "taken" ? "Screen name already taken." : null}
                {anonymousAvailability === "invalid" ? `Use ${ANONYMOUS_SCREEN_NAME_MIN_LENGTH}-${ANONYMOUS_SCREEN_NAME_MAX_LENGTH} characters.` : null}
              </p>
              <div className="authModalActions">
                <button type="button" className="authModalSecondary" onClick={() => setIsAnonymousFlowOpen(false)} disabled={isBusy}>
                  Cancel
                </button>
                <button type="submit" disabled={isBusy || anonymousAvailability === "taken" || anonymousAvailability === "invalid"}>
                  {isAnonymousSubmitting ? "Creating anonymous account..." : "Create anonymous account"}
                </button>
              </div>
              {anonymousError ? <p className="authMessage">{anonymousError}</p> : null}
            </form>
          </div>
        </div>
      ) : null}

      <div className="authDivider" aria-hidden="true">
        <span>or</span>
      </div>

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
        <button type="submit" disabled={isBusy}>
          {isSubmitting ? "Logging in..." : "Login"}
        </button>
        {error ? <p className="authMessage">{error}</p> : null}
      </form>

      {anonymousCredentials ? (
        <AnonymousCredentialsModal
          username={anonymousCredentials.username}
          password={anonymousCredentials.password}
          canBrowserSaveCredentials={canBrowserSaveAnonymousCredentials}
          isContinuing={isAnonymousCredentialsContinuePending}
          onClose={() => {
            if (!isAnonymousCredentialsContinuePending) {
              setAnonymousCredentials(null);
            }
          }}
          onContinue={handleAnonymousCredentialsContinue}
        />
      ) : null}
    </>
  );
}
