import { NextRequest, NextResponse } from "next/server";

import { filterHiddenVideos, getArtistBySlug, getStoredVideoById, getVideosByArtist, mapVideo, slugify } from "@/lib/catalog-data";
import { getOptionalApiAuth } from "@/lib/auth-request";

const MAX_BATCH_ITEMS = 50;

type BatchItemKey = string; // "artistSlug:videoId"

type BatchItemResult = {
  videoCount: number | null;
  error?: string;
};

type BatchResponse = {
  results: Record<BatchItemKey, BatchItemResult>;
};

function parseBatchItems(itemsParam: string | null): Array<{ key: string; artistSlug: string; videoId: string }> {
  if (!itemsParam) return [];

  const items = itemsParam.split(",").filter(Boolean).slice(0, MAX_BATCH_ITEMS);

  return items
    .map((raw) => {
      const trimmed = raw.trim();
      const colonIndex = trimmed.lastIndexOf(":");
      if (colonIndex === -1) return null;
      const artistSlug = trimmed.slice(0, colonIndex).trim();
      const videoId = trimmed.slice(colonIndex + 1).trim();
      if (!artistSlug || !videoId) return null;
      return { key: trimmed, artistSlug, videoId };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

async function resolveSingleArtistCount(
  artistSlug: string,
  videoId: string,
  isAuthenticated: boolean,
  userId: number | undefined,
): Promise<BatchItemResult> {
  try {
    let artist = await getArtistBySlug(artistSlug);

    if (!artist && videoId) {
      const contextStored = await getStoredVideoById(videoId, { includeUnapproved: true });
      const contextArtist = (contextStored?.parsedArtist ?? contextStored?.channelTitle ?? "").trim();
      if (contextArtist && slugify(contextArtist) === artistSlug) {
        artist = {
          name: contextArtist,
          slug: artistSlug,
          country: "Unknown",
          genre: "Rock / Metal",
          thumbnailVideoId: videoId,
        };
      }
    }

    if (!artist) {
      return { videoCount: null, error: "Artist not found" };
    }

    let matchingVideos = await getVideosByArtist(artist.name);

    if (isAuthenticated && userId) {
      const filtered = await filterHiddenVideos(matchingVideos, userId);
      if (videoId) {
        const contextVideo = matchingVideos.find((video) => video.id === videoId);
        if (contextVideo && !filtered.some((video) => video.id === videoId)) {
          filtered.unshift(contextVideo);
        }
      }
      matchingVideos = filtered;
    }

    if (videoId && !matchingVideos.some((video) => video.id === videoId)) {
      const contextStored = await getStoredVideoById(videoId, { includeUnapproved: true });
      const contextArtist = (contextStored?.parsedArtist ?? contextStored?.channelTitle ?? "").trim();
      if (contextStored && contextArtist && slugify(contextArtist) === artist.slug) {
        matchingVideos.unshift(mapVideo(contextStored));
      }
    }

    return { videoCount: matchingVideos.length };
  } catch {
    return { videoCount: null, error: "Lookup failed" };
  }
}

export async function GET(request: NextRequest) {
  const itemsParam = request.nextUrl.searchParams.get("items");
  const items = parseBatchItems(itemsParam);

  if (items.length === 0) {
    return NextResponse.json({ results: {} } satisfies BatchResponse);
  }

  // Deduplicate by key to avoid redundant work
  const uniqueItems = new Map<string, { artistSlug: string; videoId: string }>();
  for (const item of items) {
    if (!uniqueItems.has(item.key)) {
      uniqueItems.set(item.key, { artistSlug: item.artistSlug, videoId: item.videoId });
    }
  }

  const authResult = await getOptionalApiAuth(request);
  const isAuthenticated = authResult?.userId != null;

  const userId: number | undefined = authResult?.userId ?? undefined;

  // Resolve all items in parallel
  const entries = await Promise.all(
    Array.from(uniqueItems.entries()).map(async ([key, { artistSlug, videoId }]) => {
      const result = await resolveSingleArtistCount(artistSlug, videoId, isAuthenticated, userId);
      return [key, result] as const;
    }),
  );

  const results: Record<string, BatchItemResult> = {};

  // Map results back to all requested keys (including duplicates)
  for (const item of items) {
    const entry = entries.find(([key]) => key === item.key);
    if (entry) {
      results[item.key] = entry[1];
    } else {
      results[item.key] = { videoCount: null, error: "Not found" };
    }
  }

  return NextResponse.json({ results } satisfies BatchResponse);
}