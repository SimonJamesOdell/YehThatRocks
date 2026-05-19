import { NextRequest, NextResponse } from "next/server";

import { newVideosGenrePreferenceMutationSchema } from "@/lib/api-schemas";
import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import {
  getNewVideosGenrePreferenceForUser,
  setNewVideosGenrePreferenceForUser,
} from "@/lib/new-videos-preference-data";

export async function GET(request: NextRequest) {
  const auth = await requireAuthOnly(request, { authMode: "user" });

  if (!auth.ok) {
    return auth.response;
  }

  const genres = await getNewVideosGenrePreferenceForUser({
    userId: auth.auth.userId,
  });

  return NextResponse.json({
    includeGenres: genres.includeGenres,
    excludeGenres: genres.excludeGenres,
    genres: genres.includeGenres,
  });
}

export async function POST(request: NextRequest) {
  const result = await withAuthAndBody(request, newVideosGenrePreferenceMutationSchema, { authMode: "user" });

  if (!result.ok) {
    return result.response;
  }

  const prefResult = await setNewVideosGenrePreferenceForUser({
    userId: result.auth.userId,
    includeGenres: result.data.includeGenres,
    excludeGenres: result.data.excludeGenres,
    genres: result.data.genres,
  });

  if (!prefResult.ok) {
    return NextResponse.json({ ok: false, error: "Preference persistence unavailable" }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
