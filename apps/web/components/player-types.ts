import type { AutoplayMixSettings } from "@/lib/player-preferences-shared";

export type PlayerExperienceProps = {
  currentVideo: VideoRecord;
  queue: VideoRecord[];
  temporaryQueue?: VideoRecord[];
  activePlaylistId?: string | null;
  isLoggedIn: boolean;
  isAdmin?: boolean;
  isDockedDesktop?: boolean;
  suppressAuthWall?: boolean;
  stopOnEnd?: boolean;
  seenVideoIds?: Set<string>;
  onHideVideoAction?: (track: VideoRecord) => void | Promise<void>;
  onAddVideoToPlaylistAction?: (track: VideoRecord) => void | Promise<void>;
  onDockHideRequestAction?: () => void;
  onAuthRequiredAction?: () => void;
  forcedUnavailableSignal?: number;
  forcedUnavailableMessage?: string | null;
  isRouteResolving?: boolean;
  routeLoadingLabel?: string;
  routeLoadingMessage?: string;
};

export type PlaylistSummary = {
  id: string;
  name: string;
  itemCount?: number;
  createdAt?: string;
};

export type PlayerPreferencesResponse = {
  autoplayEnabled?: boolean | null;
  volume?: number | null;
  autoplayMix?: AutoplayMixSettings | null;
  autoplayGenreFilters?: string[] | null;
};

export type YouTubePlayerStateChangeEvent = {
  data: number;
};

export type YouTubePlayerErrorEvent = {
  data: number;
};

export type YouTubePlayerReadyEvent = {
  target: YouTubePlayer;
};

export type YouTubePlayer = {
  destroy: () => void;
  cueVideoById?: (videoId: string) => void;
  cueVideoByUrl?: (url: string) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  getVolume: () => number;
  isMuted: () => boolean;
  loadVideoById: (videoId: string) => void;
  loadVideoByUrl?: (url: string) => void;
  mute: () => void;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
  unMute: () => void;
};

export type YouTubeNamespace = {
  Player: new (
    element: HTMLDivElement,
    config: {
      videoId: string;
      host?: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (event: YouTubePlayerReadyEvent) => void;
        onStateChange?: (event: YouTubePlayerStateChangeEvent) => void;
        onError?: (event: YouTubePlayerErrorEvent) => void;
      };
    }
  ) => YouTubePlayer;
  PlayerState: {
    ENDED: number;
    PAUSED: number;
    PLAYING: number;
  };
};

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
    __ytrInitialPageLoadAutoplaySuppressed?: boolean;
    __ytrInitialPageLoadVideoId?: string | null;
  }
}

// Re-import for the type file to compile standalone
import type { VideoRecord } from "@/lib/catalog";
