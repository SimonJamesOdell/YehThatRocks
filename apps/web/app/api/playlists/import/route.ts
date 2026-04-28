import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuth } from "@/lib/auth-request";
import { addPlaylistItems, createPlaylist, hasDatabaseUrl, importVideoFromDirectSource, normalizeYouTubeVideoId } from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { parseRequestJson } from "@/lib/request-json";

const importPlaylistSchema = z.object({
  source: z.string().trim().min(1).max(2048),
  name: z.string().trim().min(2).max(80).optional(),
});

const YOUTUBE_PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;
const YOUTUBE_DATA_API_KEY = process.env.YOUTUBE_DATA_API_KEY?.trim() || "";
const MAX_PLAYLIST_ITEMS = 1000;
const MAX_PAGES = 20;
const INGEST_CONCURRENCY = 4;

function maybeNormalizePlaylistId(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed || !YOUTUBE_PLAYLIST_ID_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function parsePlaylistIdFromSource(source: string) {
  const trimmed = source.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const playlistIdFromQuery = maybeNormalizePlaylistId(url.searchParams.get("list"));
    if (playlistIdFromQuery) {
      return playlistIdFromQuery;
    }

    if (url.pathname.toLowerCase().startsWith("/playlist")) {
      return maybeNormalizePlaylistId(url.searchParams.get("list"));
    }
  } catch {
    const playlistParamMatch = trimmed.match(/[?&]list=([A-Za-z0-9_-]{10,})/i);
    if (playlistParamMatch?.[1]) {
      return playlistParamMatch[1];
    }
  }

  const barePlaylistId = maybeNormalizePlaylistId(trimmed);
  if (barePlaylistId && /^(PL|UU|LL|RD|OLAK5uy_)/.test(barePlaylistId)) {
    return barePlaylistId;
  }

  return null;
}

async function fetchPlaylistTitle(playlistId: string): Promise<string | null> {
  const endpoint = new URL("https://www.googleapis.com/youtube/v3/playlists");
  endpoint.searchParams.set("part", "snippet");
  endpoint.searchParams.set("id", playlistId);
  endpoint.searchParams.set("maxResults", "1");
  endpoint.searchParams.set("key", YOUTUBE_DATA_API_KEY);

  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": "YehThatRocks/1.0",
    },
    cache: "no-store",
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        items?: Array<{ snippet?: { title?: string } }>;
      }
    | null;

  const title = payload?.items?.[0]?.snippet?.title?.trim();
  return title?.length ? title : null;
}

async function fetchPlaylistVideoIds(playlistId: string) {
  if (!YOUTUBE_DATA_API_KEY) {
    return { ok: false as const, error: "YouTube Data API key is not configured on the server." };
  }

  const collected: string[] = [];
  const dedupe = new Set<string>();
  let pageToken: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const endpoint = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    endpoint.searchParams.set("part", "contentDetails");
    endpoint.searchParams.set("maxResults", "50");
    endpoint.searchParams.set("playlistId", playlistId);
    endpoint.searchParams.set("key", YOUTUBE_DATA_API_KEY);
    if (pageToken) {
      endpoint.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(endpoint, {
      headers: {
        "User-Agent": "YehThatRocks/1.0",
      },
      cache: "no-store",
    }).catch(() => null);

    if (!response?.ok) {
      return { ok: false as const, error: "Could not read playlist from YouTube." };
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          items?: Array<{ contentDetails?: { videoId?: string } }>;
          nextPageToken?: string;
        }
      | null;

    for (const item of payload?.items ?? []) {
      const normalizedVideoId = normalizeYouTubeVideoId(item.contentDetails?.videoId);
      if (!normalizedVideoId || dedupe.has(normalizedVideoId)) {
        continue;
      }

      dedupe.add(normalizedVideoId);
      collected.push(normalizedVideoId);

      if (collected.length >= MAX_PLAYLIST_ITEMS) {
        return { ok: true as const, videoIds: collected };
      }
    }

    if (!payload?.nextPageToken) {
      break;
    }

    pageToken = payload.nextPageToken;
  }

  return { ok: true as const, videoIds: collected };
}

async function ingestMissingVideoIds(videoIds: string[]) {
  if (videoIds.length === 0) {
    return {
      importedVideoIds: [] as string[],
      failedVideoIds: [] as string[],
    };
  }

  const importedVideoIds: string[] = [];
  const failedVideoIds: string[] = [];
  let cursor = 0;

  const workers = Array.from({ length: Math.min(INGEST_CONCURRENCY, videoIds.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;

      if (index >= videoIds.length) {
        return;
      }

      const videoId = videoIds[index];

      try {
        const result = await importVideoFromDirectSource(videoId, { discoverRelated: false });
        if (result.videoId) {
          importedVideoIds.push(result.videoId);
        } else {
          failedVideoIds.push(videoId);
        }
      } catch {
        failedVideoIds.push(videoId);
      }
    }
  });

  await Promise.all(workers);

  return {
    importedVideoIds,
    failedVideoIds,
  };
}

function buildDefaultImportedPlaylistName(sourceTitle: string | null) {
  if (sourceTitle?.trim()) {
    return sourceTitle.slice(0, 80);
  }

  return `Imported playlist ${new Date().toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const csrfError = verifySameOrigin(request);
  if (csrfError) {
    return csrfError;
  }

  const bodyResult = await parseRequestJson(request);

  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = importPlaylistSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const playlistId = parsePlaylistIdFromSource(parsed.data.source);
  if (!playlistId) {
    return NextResponse.json({ error: "Provide a valid YouTube playlist URL or playlist ID." }, { status: 400 });
  }

  const playlistFetchResult = await fetchPlaylistVideoIds(playlistId);

  if (!playlistFetchResult.ok) {
    return NextResponse.json({ error: playlistFetchResult.error }, { status: 400 });
  }

  if (playlistFetchResult.videoIds.length === 0) {
    return NextResponse.json({ error: "No videos were found in that YouTube playlist." }, { status: 400 });
  }

  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Playlist import requires a configured database." }, { status: 503 });
  }

  const sourcePlaylistTitle = await fetchPlaylistTitle(playlistId);
  const requestedPlaylistName = parsed.data.name?.trim();
  const playlistName = (requestedPlaylistName && requestedPlaylistName.length >= 2
    ? requestedPlaylistName
    : buildDefaultImportedPlaylistName(sourcePlaylistTitle)).slice(0, 80);

  const existingRows = await prisma.video.findMany({
    where: {
      videoId: {
        in: playlistFetchResult.videoIds,
      },
    },
    select: {
      videoId: true,
    },
  });

  const existingVideoIdSet = new Set(existingRows.map((row) => normalizeYouTubeVideoId(row.videoId) ?? row.videoId));
  const missingVideoIds = playlistFetchResult.videoIds.filter((videoId) => !existingVideoIdSet.has(videoId));

  const ingestResult = await ingestMissingVideoIds(missingVideoIds);
  const importedSet = new Set(ingestResult.importedVideoIds.map((id) => normalizeYouTubeVideoId(id) ?? id));

  const playlistVideoIds = playlistFetchResult.videoIds.filter((videoId) => existingVideoIdSet.has(videoId) || importedSet.has(videoId));

  if (playlistVideoIds.length === 0) {
    return NextResponse.json({ error: "None of the playlist videos could be imported into the catalog." }, { status: 422 });
  }

  try {
    const createdPlaylist = await createPlaylist(playlistName, [], authResult.auth.userId);
    const updatedPlaylist = await addPlaylistItems(createdPlaylist.id, playlistVideoIds, authResult.auth.userId);

    return NextResponse.json({
      ok: true,
      playlist: updatedPlaylist ?? createdPlaylist,
      source: {
        playlistId,
        playlistTitle: sourcePlaylistTitle,
      },
      stats: {
        sourceVideoCount: playlistFetchResult.videoIds.length,
        matchedVideoCount: playlistVideoIds.length,
        existingVideoCount: existingVideoIdSet.size,
        importedVideoCount: importedSet.size,
        failedImportCount: ingestResult.failedVideoIds.length,
      },
    }, { status: 201 });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);

    return NextResponse.json(
      {
        error: "Could not import playlist.",
        ...(process.env.NODE_ENV !== "production" ? { details } : null),
      },
      { status: 500 },
    );
  }
}
