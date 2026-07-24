"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AnonymousCredentialsModal } from "@/components/anonymous-credentials-modal";
import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";
import { publishAuthStateChange } from "@/lib/auth-sync";
import { AUTO_LOGIN_SUPPRESS_ONCE_KEY, INTRO_SKIP_ONCE_AFTER_LOGIN_KEY, ANONYMOUS_USERNAME_KEY } from "@/lib/storage-keys";
import { parseJsonOrNull } from "@/lib/parse-json";

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
  if (typeof window === "undefined") return false;
  const credentials = getBrowserCredentialsContainer();
  return "PasswordCredential" in window && typeof credentials?.store === "function";
}

const SCREEN_NAME_MIN_LENGTH = 2;
const SCREEN_NAME_MAX_LENGTH = 40;
const SUGGESTION_TIMEOUT_MS = 4000;
const SUGGESTION_PREFIXES = ["Metal", "Riff", "Iron", "Neon", "Storm", "Night", "Echo", "Steel"];
const SUGGESTION_SUFFIXES = ["Wolf", "Rider", "Fury", "Howl", "Blade", "Pulse", "Flame", "Static"];

function buildFallbackSuggestion() {
  const prefix = SUGGESTION_PREFIXES[Math.floor(Math.random() * SUGGESTION_PREFIXES.length)] ?? "Metal";
  const suffix = SUGGESTION_SUFFIXES[Math.floor(Math.random() * SUGGESTION_SUFFIXES.length)] ?? "Wolf";
  const num = Math.floor(100 + Math.random() * 900);
  return `${prefix}${suffix}${num}`;
}

function consumeAutoLoginSuppressionOnce() {
  if (typeof window === "undefined") return false;
  const shouldSuppress = window.sessionStorage.getItem(AUTO_LOGIN_SUPPRESS_ONCE_KEY) === "1";
  if (shouldSuppress) window.sessionStorage.removeItem(AUTO_LOGIN_SUPPRESS_ONCE_KEY);
  return shouldSuppress;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function markIntroSkipOnce() {
  window.sessionStorage.setItem(INTRO_SKIP_ONCE_AFTER_LOGIN_KEY, "1");
}

export function AnonymousSignupModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [screenName, setScreenName] = useState("");
  const [suggestedScreenName, setSuggestedScreenName] = useState("");
  const [shouldClearSuggestion, setShouldClearSuggestion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(null);
  const [isCredentialsContinuePending, setIsCredentialsContinuePending] = useState(false);

  const hasOpenedRef = useRef(false);

  // ── Open: fetch suggested screen name ──────────────────────────────────

  useEffect(() => {
    if (!isOpen || hasOpenedRef.current) return;
    hasOpenedRef.current = true;

    setIsPreparing(true);
    setError(null);
    setScreenName("");
    setSuggestedScreenName("");
    setShouldClearSuggestion(false);
    setAvailability("idle");
    setCredentials(null);
    consumeAutoLoginSuppressionOnce();

    void (async () => {
      try {
        await assignAvailableSuggestion();
      } finally {
        setIsPreparing(false);
      }
    })();
  }, [isOpen]);

  // ── Reset when closed ─────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) {
      // Delay reset so the fade-out transition isn't janky.
      const id = window.setTimeout(() => {
        hasOpenedRef.current = false;
        setScreenName("");
        setSuggestedScreenName("");
        setShouldClearSuggestion(false);
        setError(null);
        setAvailability("idle");
        setCredentials(null);
      }, 300);
      return () => window.clearTimeout(id);
    }
  }, [isOpen]);

  // ── Screen-name availability debounce ─────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;

    const name = screenName.trim();
    if (name.length === 0) {
      setAvailability("idle");
      return;
    }
    if (name.length < SCREEN_NAME_MIN_LENGTH || name.length > SCREEN_NAME_MAX_LENGTH) {
      setAvailability("invalid");
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setAvailability("checking");
      try {
        const result = await checkAvailability(name);
        if (cancelled) return;
        if (!result.ok) {
          setAvailability("invalid");
          if (result.error) setError(result.error);
          return;
        }
        setAvailability(result.available ? "available" : "taken");
      } catch {
        if (!cancelled) setAvailability("idle");
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [screenName, isOpen]);

  // ── Close on Escape ───────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSubmitting) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  // ── Prevent body scroll ───────────────────────────────────────────────

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

  // ── Helpers ───────────────────────────────────────────────────────────

  function redirectAfterAuth() {
    const videoParam = new URLSearchParams(window.location.search).get("v");
    const target = videoParam ? `/?v=${encodeURIComponent(videoParam)}` : "/";
    markIntroSkipOnce();
    dispatchAppEvent(EVENT_NAMES.AUTH_SUCCESS, null);
    publishAuthStateChange("authenticated");
    router.push(target);
    router.refresh();
  }

  async function checkAvailability(name: string) {
    const response = await fetchWithTimeout(
      `/api/auth/anonymous?screenName=${encodeURIComponent(name)}`,
      { method: "GET", cache: "no-store" },
      SUGGESTION_TIMEOUT_MS,
    );
    const payload = await parseJsonOrNull<AnonymousAvailabilityResponse>(response);
    return { ok: response.ok, available: payload?.available === true, error: payload?.error };
  }

  async function assignAvailableSuggestion() {
    setAvailability("checking");

    // Try server suggestion first.
    try {
      const response = await fetchWithTimeout("/api/auth/anonymous", {
        method: "GET", cache: "no-store",
      }, SUGGESTION_TIMEOUT_MS);
      const payload = await parseJsonOrNull<AnonymousAvailabilityResponse>(response);
      if (response.ok && payload?.screenName) {
        setSuggestedScreenName(payload.screenName);
        setScreenName(payload.screenName);
        setShouldClearSuggestion(true);
        setAvailability("available");
        return;
      }
      setAvailability("idle");
      setError(payload?.error ?? "Could not find an available screen name right now. Please enter your own.");
      return;
    } catch {
      // Fall through.
    }

    // Compatibility fallback: brute-force suggestions.
    for (let attempt = 0; attempt < 30; attempt++) {
      const candidate = buildFallbackSuggestion();
      try {
        const result = await checkAvailability(candidate);
        if (!result.ok) continue;
        if (result.available) {
          setSuggestedScreenName(candidate);
          setScreenName(candidate);
          setShouldClearSuggestion(true);
          setAvailability("available");
          return;
        }
      } catch {
        continue;
      }
    }

    setAvailability("idle");
    setError("Could not find an available screen name right now. Please enter your own.");
  }

  // ── Submit: create anonymous account ──────────────────────────────────

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = screenName.trim();
    if (name.length < SCREEN_NAME_MIN_LENGTH || name.length > SCREEN_NAME_MAX_LENGTH) {
      setError(`Screen name must be between ${SCREEN_NAME_MIN_LENGTH} and ${SCREEN_NAME_MAX_LENGTH} characters.`);
      setAvailability("invalid");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/anonymous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screenName: name }),
      });

      const payload = (await parseJsonOrNull(response)) as AnonymousCreateResponse | null;

      if (!response.ok || !payload?.credentials) {
        setAvailability(response.status === 409 ? "taken" : availability);
        setError(payload?.error ?? "Could not create anonymous account.");
        return;
      }

      if (typeof window !== "undefined") {
        window.localStorage.setItem(ANONYMOUS_USERNAME_KEY, payload.credentials.username);
      }

      setCredentials(payload.credentials);
    } catch {
      setError("Could not create anonymous account.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Continue after credentials shown ──────────────────────────────────

  async function submitLogin(email: string, password: string): Promise<boolean> {
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember: true }),
      });
      if (!response.ok) return false;
      return true;
    } catch {
      return false;
    }
  }

  async function storeBrowserCredential(username: string, password: string) {
    const creds = getBrowserCredentialsContainer();
    if (typeof window === "undefined" || !("PasswordCredential" in window) || !creds?.store) return;
    try {
      const PasswordCredentialCtor = (window as typeof window & {
        PasswordCredential?: new (data: { id: string; password: string; name?: string }) => Credential;
      }).PasswordCredential;
      if (!PasswordCredentialCtor) return;
      const credential = new PasswordCredentialCtor({ id: username, password, name: username });
      await creds.store(credential);
    } catch {
      // Ignore.
    }
  }

  async function handleCredentialsContinue() {
    if (!credentials || isCredentialsContinuePending) return;

    setError(null);
    setIsCredentialsContinuePending(true);

    try {
      const canSave = canStoreBrowserCredential();
      if (canSave) {
        await storeBrowserCredential(credentials.username, credentials.password);
      }

      // Check if already authenticated.
      let authenticated = false;
      try {
        const meRes = await fetch("/api/auth/me", { method: "GET", cache: "no-store" });
        authenticated = meRes.ok;
      } catch { /* not authenticated */ }

      if (!authenticated) {
        authenticated = await submitLogin(credentials.username, credentials.password);
      }

      if (!authenticated) {
        setError("Could not finalize sign-in in this browser mode. Please log in using your saved credentials.");
        return;
      }

      setCredentials(null);
      router.refresh();
      redirectAfterAuth();
    } finally {
      setIsCredentialsContinuePending(false);
    }
  }

  const isBusy = isSubmitting || isPreparing || isCredentialsContinuePending;

  // ── Render ─────────────────────────────────────────────────────────────

  if (!isOpen) return null;

  return (
    <div
      className="anonymousSignupOverlay"
      role="presentation"
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      {!credentials ? (
        <div
          className="authModalCard"
          role="dialog"
          aria-modal="true"
          aria-labelledby="anon-signup-title"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="authModalHeader">
            <div className="authModalHeaderCopy">
              <p className="authModalEyebrow">Anonymous login</p>
              <h2 id="anon-signup-title" className="authModalTitle">Choose your screen name</h2>
              <p className="authModalLead">
                Jump straight in now, with full member features, add recovery later only if you want it.
              </p>
            </div>
            <button
              type="button"
              className="authModalClose"
              aria-label="Close anonymous login"
              onClick={onClose}
              disabled={isBusy}
            >
              ×
            </button>
          </div>

          <form className="authForm anonymousAuthForm" onSubmit={handleCreate}>
            <label>
              <span>Screen name</span>
              <input
                name="anonymousScreenName"
                type="text"
                value={screenName}
                onClick={() => {
                  if (shouldClearSuggestion && screenName === suggestedScreenName) {
                    setScreenName("");
                    setAvailability("idle");
                    setShouldClearSuggestion(false);
                  }
                }}
                onChange={(event) => {
                  setScreenName(event.currentTarget.value);
                  setError(null);
                  setShouldClearSuggestion(false);
                }}
                placeholder={suggestedScreenName || "MetalFan204"}
                minLength={SCREEN_NAME_MIN_LENGTH}
                maxLength={SCREEN_NAME_MAX_LENGTH}
                autoComplete="nickname"
                required
              />
            </label>
            <div className="authModalMetaRow">
              <p className="authSupportCopy authModalCopy">
                Pick something memorable. You can attach an email later to turn on password recovery.
              </p>
              <span className="authModalLengthHint">
                {SCREEN_NAME_MIN_LENGTH}-{SCREEN_NAME_MAX_LENGTH} chars
              </span>
            </div>
            <p
              className={`authAvailability authAvailability${availability[0]?.toUpperCase() ?? "I"}${availability.slice(1)}`}
              aria-live="polite"
              role="status"
            >
              {availability === "checking" ? "Checking availability..." : null}
              {availability === "available" ? "Screen name available." : null}
              {availability === "taken" ? "Screen name already taken." : null}
              {availability === "invalid"
                ? `Use ${SCREEN_NAME_MIN_LENGTH}-${SCREEN_NAME_MAX_LENGTH} characters.`
                : null}
            </p>
            <div className="authModalActions">
              <button type="button" className="authModalSecondary" onClick={onClose} disabled={isBusy}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={isBusy || availability === "taken" || availability === "invalid"}
              >
                {isSubmitting ? "Creating anonymous account..." : "Create anonymous account"}
              </button>
            </div>
            {error ? <p className="authMessage">{error}</p> : null}
          </form>
        </div>
      ) : (
        <AnonymousCredentialsModal
          username={credentials.username}
          password={credentials.password}
          canBrowserSaveCredentials={canStoreBrowserCredential()}
          isContinuing={isCredentialsContinuePending}
          onClose={() => {
            if (!isCredentialsContinuePending) onClose();
          }}
          onContinue={handleCredentialsContinue}
        />
      )}
    </div>
  );
}
