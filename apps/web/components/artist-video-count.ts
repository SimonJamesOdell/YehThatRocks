"use client";

import { fetchArtistVideoCountBatched } from "@/components/artist-count-batcher";

export async function fetchArtistVideoCountForCard(artistSlug: string, videoId: string): Promise<number | null> {
  return fetchArtistVideoCountBatched(artistSlug, videoId);
}
