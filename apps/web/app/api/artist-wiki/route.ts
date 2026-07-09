import { NextRequest, NextResponse } from "next/server";

import { generateAndCacheWiki, getCachedWikiOnly } from "@/lib/artist-wiki";
import { verifySameOrigin } from "@/lib/csrf";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow up to 60 seconds for LLM generation

type WikiGenerateRequest = {
  artistName: string;
  slug: string;
};

export async function POST(request: NextRequest) {
  try {
    // CSRF check for browser-initiated requests
    const csrfError = verifySameOrigin(request);
    if (csrfError) {
      return csrfError;
    }

    const body = (await request.json().catch(() => null)) as WikiGenerateRequest | null;

    if (!body || typeof body.artistName !== "string" || !body.artistName.trim()) {
      return NextResponse.json(
        { error: "Missing or invalid artistName" },
        { status: 400 },
      );
    }

    const artistName = body.artistName.trim();
    const slug = (body.slug || "").trim();

    // Fast path: check cache first
    const cached = await getCachedWikiOnly(artistName, slug);
    if (cached) {
      return NextResponse.json({
        status: "cached",
        wiki: cached,
      });
    }

    // Generate and cache
    const wiki = await generateAndCacheWiki(artistName, slug);

    return NextResponse.json({
      status: "cached",
      wiki,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    if (message.includes("WIKI_GENERATION_DISABLED")) {
      return NextResponse.json(
        { error: "Wiki generation is currently disabled.", retryable: false },
        { status: 503 },
      );
    }

    if (message.includes("WIKI_ARTIST_NAME_REJECTED")) {
      return NextResponse.json(
        { error: "Could not validate this artist name.", retryable: false },
        { status: 422 },
      );
    }

    // For trusted-source and other errors, allow retry
    return NextResponse.json(
      { error: message, retryable: true },
      { status: 503 },
    );
  }
}

/**
 * GET: Check if a wiki is cached (lightweight ping, no generation).
 * Used by the client to poll for completion.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const artistName = url.searchParams.get("artistName") || "";
    const slug = url.searchParams.get("slug") || "";

    if (!artistName.trim()) {
      return NextResponse.json(
        { error: "Missing artistName parameter" },
        { status: 400 },
      );
    }

    const cached = await getCachedWikiOnly(artistName.trim(), slug.trim());

    if (cached) {
      return NextResponse.json({
        status: "cached",
        wiki: cached,
      });
    }

    return NextResponse.json({
      status: "not_found",
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
