"use client";

import {
  createContext,
  useCallback,
  useContext,
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
};

const MobilePlayerContext = createContext<MobilePlayerContextValue | null>(null);

export function useMobilePlayer() {
  const ctx = useContext(MobilePlayerContext);
  if (!ctx) {
    throw new Error("useMobilePlayer must be used within MobilePlayerProvider");
  }
  return ctx;
}

export function MobilePlayerProvider({ children }: { children: ReactNode }) {
  const [player, setPlayer] = useState<MobilePlayerState>({
    video: null,
    isPlaying: false,
    isFullscreen: false,
  });
  const playerApiRef = useRef<YouTubePlayerHandle | null>(null);

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
      }}
    >
      {children}
    </MobilePlayerContext.Provider>
  );
}
