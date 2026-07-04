"use client";

import { useMobilePlayer } from "@/components/mobile/mobile-player-context";

type MagazineCTAProps = {
  videoId: string | null;
  artist: string;
  artistSlug: string;
};

export function MagazineCTA({ videoId, artist, artistSlug }: MagazineCTAProps) {
  const { playVideo } = useMobilePlayer();

  if (videoId) {
    return (
      <button
        type="button"
        className="mobile-magazine-cta"
        onClick={() => playVideo({
          id: videoId,
          title: artist,
          channelTitle: artist,
          genre: "",
          favourited: 0,
        })}
      >
        Watch now in YehThatRocks
      </button>
    );
  }

  return (
    <a href={`/m/artist/${artistSlug}`} className="mobile-magazine-cta">
      Explore {artist}
    </a>
  );
}
