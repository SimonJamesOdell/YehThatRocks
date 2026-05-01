import { NextRequest, NextResponse } from "next/server";

import { favouriteMutationSchema } from "@/lib/api-schemas";
import { requireApiAuth } from "@/lib/auth-request";
import { filterHiddenVideos, getFavouriteVideos, getFavouriteVideosPage, updateFavourite } from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const limitRaw = request.nextUrl.searchParams.get("limit");
  const offsetRaw = request.nextUrl.searchParams.get("offset");
  const hasPaging = limitRaw !== null || offsetRaw !== null;

  if (!hasPaging) {
    let favourites = await getFavouriteVideos(authResult.auth.userId);
    // Filter out blocked videos from favourites
    favourites = await filterHiddenVideos(favourites, authResult.auth.userId);

    return NextResponse.json({
      favourites,
      totalCount: favourites.length,
      hasMore: false,
      nextOffset: favourites.length,
    });
  }

  const parsedLimit = Number(limitRaw ?? "20");
  const parsedOffset = Number(offsetRaw ?? "0");
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(100, Math.floor(parsedLimit))) : 20;
  const offset = Number.isFinite(parsedOffset) ? Math.max(0, Math.floor(parsedOffset)) : 0;

  const paged = await getFavouriteVideosPage(authResult.auth.userId, { limit, offset });

  return NextResponse.json({
    favourites: paged.favourites,
    totalCount: paged.totalCount,
    hasMore: paged.hasMore,
    nextOffset: paged.nextOffset,
  });
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

  const parsed = favouriteMutationSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await updateFavourite(parsed.data.videoId, parsed.data.action, authResult.auth.userId);
  return NextResponse.json(result);
}
