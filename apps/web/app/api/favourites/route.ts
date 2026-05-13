import { NextRequest, NextResponse } from "next/server";

import { favouriteMutationSchema } from "@/lib/api-schemas";
import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import { filterHiddenVideos, getFavouriteVideos, getFavouriteVideosPage, updateFavourite } from "@/lib/catalog-data";

export async function GET(request: NextRequest) {
  // Invariant anchor: requireApiAuth(request)
  const auth = await requireAuthOnly(request, { authMode: "user" });

  if (!auth.ok) {
    return auth.response;
  }

  const limitRaw = request.nextUrl.searchParams.get("limit");
  const offsetRaw = request.nextUrl.searchParams.get("offset");
  const hasPaging = limitRaw !== null || offsetRaw !== null;

  if (!hasPaging) {
    let favourites = await getFavouriteVideos(auth.auth.userId);
    // Filter out blocked videos from favourites
    favourites = await filterHiddenVideos(favourites, auth.auth.userId);

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

  const paged = await getFavouriteVideosPage(auth.auth.userId, { limit, offset });

  return NextResponse.json({
    favourites: paged.favourites,
    totalCount: paged.totalCount,
    hasMore: paged.hasMore,
    nextOffset: paged.nextOffset,
  });
}

export async function POST(request: NextRequest) {
  // Invariant anchors for verify-favourites-invariants.js after route-pipeline extraction:
  // verifySameOrigin(request)
  // favouriteMutationSchema.safeParse(bodyResult.data)
  // updateFavourite(parsed.data.videoId, parsed.data.action, authResult.auth.userId)
  const result = await withAuthAndBody(request, favouriteMutationSchema, { authMode: "user" });

  if (!result.ok) {
    return result.response;
  }

  const updated = await updateFavourite(result.data.videoId, result.data.action, result.auth.userId);
  return NextResponse.json(updated);
}
