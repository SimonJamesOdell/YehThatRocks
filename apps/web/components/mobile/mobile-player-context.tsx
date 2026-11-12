"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { refreshAuthSession } from "@/lib/client-auth-fetch";
import { probeClientAuthState } from "@/lib/client-auth-state";

export type MobileVideo = {
  id: string;
  title: string;
  channelTitle: string;
  parsedArtist?: string | null;
  parsedTrack?: string | null;
  genre: string;
  favourited: number;
};

// Minimal interface for the YouTube IFrame Player API handle
export interface YouTubePlayerHandle {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  destroy(): void;
}

type AuthState = {
  isLoggedIn: boolean;
  userId: number | null;
  screenName: string | null;
  checked: boolean;
};

type MobilePlayerState = {
  video: MobileVideo | null;
  isPlaying: boolean;
  isFullscreen: boolean;
};

type MobilePlayerContextValue = {
  player: MobilePlayerState;
  playVideo: (video: MobileVideo) => void;
  pauseVideo: () => void;
  resumeVideo: () => void;
  stopVideo: () => void;
  openFullscreen: () => void;
  closeFullscreen: () => void;
  playerApiRef: React.MutableRefObject<YouTubePlayerHandle | null>;
  auth: AuthState;
  refreshAuth: () => void;
};

type MobilePlayerProviderProps = {
  children: ReactNode;
  /** Pre-resolved auth state from server-side layout. When provided,
   *  the initial /api/auth/me roundtrip is skipped. */
  initialAuth?: {
    isLoggedIn: boolean;
    userId: number | null;
    screenName: string | null;
    checked: true;
  };
};

const MobilePlayerContext = createContext<MobilePlayerContextValue | null>(null);

export function useMobilePlayer() {
  const ctx = useContext(MobilePlayerContext);
  if (!ctx) {
    throw new Error("useMobilePlayer must be used within MobilePlayerProvider");
  }
  return ctx;
}

export function MobilePlayerProvider({ children, initialAuth }: MobilePlayerProviderProps) {
  const [player, setPlayer] = useState<MobilePlayerState>({
    video: null,
    isPlaying: false,
    isFullscreen: false,
  });
  const [auth, setAuth] = useState<AuthState>(
    initialAuth
      ? { isLoggedIn: initialAuth.isLoggedIn, userId: initialAuth.userId, screenName: initialAuth.screenName, checked: true }
      : { isLoggedIn: false, userId: null, screenName: null, checked: false },
  );
  const playerApiRef = useRef<YouTubePlayerHandle | null>(null);

  const refreshAuth = useCallback(async () => {
    // Use the same hardened probe as the desktop shell: an expired access
    // token is silently renewed via the refresh token, and HTML challenge
    // interstitials / network failures are treated as transient ("unavailable")
    // so a Cloudflare bot-fight page or a dropped request never logs a healthy
    // mobile session out.
    const result = await probeClientAuthState(refreshAuthSession);

    if (result === "unavailable") {
      // Transient — keep whatever state we already have, only mark as checked.
      setAuth((prev) => (prev.checked ? prev : { ...prev, checked: true }));
      return;
    }

    if (result === "unauthenticated") {
      // Definitive sign-out (no/invalid/revoked refresh token).
      setAuth({ isLoggedIn: false, userId: null, screenName: null, checked: true });
      return;
    }

    // Authenticated — fetch the user detail for the account nav.
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { user?: { id?: number | null; screenName?: string | null } };
        setAuth({
          isLoggedIn: true,
          userId: data.user?.id ?? null,
          screenName: data.user?.screenName ?? null,
          checked: true,
        });
        return;
      }
    } catch {
      // Fall through — the session is authenticated; keep the current details.
    }

    setAuth((prev) => ({ ...prev, isLoggedIn: true, checked: true }));
  }, []);

  // Reconcile auth on mount: even when the server pre-resolved a logged-out
  // state (expired access token but valid refresh token), this silently
  // restores the session. For genuinely logged-out visitors it simply confirms
  // the state — no account is auto-created here.
  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  // Keep a long-lived session alive while the tab is open: re-check on a timer
  // and whenever the tab becomes visible / the network returns. This mirrors the
  // desktop shell's 60s auth poll so an idle mobile tab does not drift to
  // "logged out" once its 15-minute access token expires.
  useEffect(() => {
    if (!auth.isLoggedIn) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void refreshAuth();
    }, 60_000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshAuth();
      }
    };
    const onWindowOnline = () => {
      void refreshAuth();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onWindowOnline);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onWindowOnline);
    };
  }, [auth.isLoggedIn, refreshAuth]);

  const playVideo = useCallback((video: MobileVideo) => {
    setPlayer({ video, isPlaying: true, isFullscreen: true });
  }, []);

  const pauseVideo = useCallback(() => {
    playerApiRef.current?.pauseVideo();
    setPlayer((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  const resumeVideo = useCallback(() => {
    playerApiRef.current?.playVideo();
    setPlayer((prev) => ({ ...prev, isPlaying: true }));
  }, []);

  const stopVideo = useCallback(() => {
    playerApiRef.current?.stopVideo();
    setPlayer({ video: null, isPlaying: false, isFullscreen: false });
  }, []);

  const openFullscreen = useCallback(() => {
    setPlayer((prev) => ({ ...prev, isFullscreen: true }));
  }, []);

  const closeFullscreen = useCallback(() => {
    setPlayer((prev) => ({ ...prev, isFullscreen: false }));
  }, []);

  return (
    <MobilePlayerContext.Provider
      value={{
        player,
        playVideo,
        pauseVideo,
        resumeVideo,
        stopVideo,
        openFullscreen,
        closeFullscreen,
        playerApiRef,
        auth,
        refreshAuth,
      }}
    >
      {children}
    </MobilePlayerContext.Provider>
  );
}
