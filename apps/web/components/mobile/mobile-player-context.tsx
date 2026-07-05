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
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        setAuth({
          isLoggedIn: true,
          userId: data.user?.id ?? null,
          screenName: data.user?.screenName ?? null,
          checked: true,
        });
      } else {
        setAuth({ isLoggedIn: false, userId: null, screenName: null, checked: true });
      }
    } catch {
      setAuth({ isLoggedIn: false, userId: null, screenName: null, checked: true });
    }
  }, []);

  // Check auth on mount — only when not preloaded server-side
  useEffect(() => {
    if (!initialAuth) {
      refreshAuth();
    }
  }, [initialAuth, refreshAuth]);

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
