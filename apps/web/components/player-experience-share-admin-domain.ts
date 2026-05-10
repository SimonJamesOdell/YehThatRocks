import type { VideoRecord } from "@/lib/catalog";

type SocialShareTarget = {
  id: string;
  label: string;
  href: string;
};

type ResolvePostDeleteNextVideoOptions = {
  removedVideoId: string;
  resolvedNextVideoId: string | null;
  playlistQueueIds: string[];
  activePlaylistId: string | null;
  effectivePlaylistIndex: number | null;
  temporaryQueue: VideoRecord[];
  queue: VideoRecord[];
};

export function buildSocialShareTargets(shareUrl: string, displayTitle: string): readonly SocialShareTarget[] {
  return [
    {
      id: "x",
      label: "Share on X",
      href: `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(displayTitle)}`,
    },
    {
      id: "facebook",
      label: "Share on Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
    },
    {
      id: "reddit",
      label: "Share on Reddit",
      href: `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(displayTitle)}`,
    },
    {
      id: "linkedin",
      label: "Share on LinkedIn",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
    },
    {
      id: "whatsapp",
      label: "Share on WhatsApp",
      href: `https://api.whatsapp.com/send?text=${encodeURIComponent(`${displayTitle} ${shareUrl}`)}`,
    },
    {
      id: "telegram",
      label: "Share on Telegram",
      href: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(displayTitle)}`,
    },
    {
      id: "email",
      label: "Share by Email",
      href: `mailto:?subject=${encodeURIComponent(displayTitle)}&body=${encodeURIComponent(`Check this out: ${shareUrl}`)}`,
    },
  ] as const;
}

export function resolvePostDeleteNextVideo(options: ResolvePostDeleteNextVideoOptions) {
  const remainingPlaylistIds = options.playlistQueueIds.filter((id) => id !== options.removedVideoId);
  const playlistCarryIndex = Math.max(
    0,
    Math.min(
      options.effectivePlaylistIndex ?? options.playlistQueueIds.findIndex((id) => id === options.removedVideoId),
      Math.max(remainingPlaylistIds.length - 1, 0),
    ),
  );

  const playlistCandidateId =
    options.activePlaylistId && remainingPlaylistIds.length > 0
      ? (remainingPlaylistIds[playlistCarryIndex] ?? remainingPlaylistIds[0] ?? null)
      : null;
  const preferredResolvedId =
    options.resolvedNextVideoId && options.resolvedNextVideoId !== options.removedVideoId
      ? options.resolvedNextVideoId
      : null;
  const temporaryQueueCandidateId =
    options.temporaryQueue.find((video) => video.id !== options.removedVideoId)?.id ?? null;
  const queueCandidateId = options.queue.find((video) => video.id !== options.removedVideoId)?.id ?? null;

  const nextId = preferredResolvedId ?? playlistCandidateId ?? temporaryQueueCandidateId ?? queueCandidateId;
  const nextPlaylistIndex = nextId ? remainingPlaylistIds.indexOf(nextId) : -1;

  return {
    nextId,
    nextPlaylistIndex,
  };
}
