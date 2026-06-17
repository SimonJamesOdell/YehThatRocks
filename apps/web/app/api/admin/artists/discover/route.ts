import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { discoverTracksForArtist } from "@/lib/artist-discovery";
import { hasDatabaseUrl } from "@/lib/catalog-data";
import { requireAdminApiAuthWithPermission } from "@/lib/admin-auth";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

const discoverSchema = z.object({
  artistName: z.string().trim().min(1).max(255),
  maxResults: z.number().int().min(1).max(50).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAdminApiAuthWithPermission(request, "admin.videos.pending.moderate");

  if (!auth.ok) {
    return auth.response;
  }

  const csrf = verifySameOrigin(request);
  if (csrf) {
    return csrf;
  }

  const body = await parseRequestJson(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = discoverSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!hasDatabaseUrl()) {
    return NextResponse.json({ ok: false, error: "Database is not configured." }, { status: 503 });
  }

  const artistName = parsed.data.artistName.trim();
  const maxResults = parsed.data.maxResults ?? 20;

  const result = await discoverTracksForArtist(artistName, maxResults);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    artistName: result.artistName,
    scanned: result.scanned,
    imported: result.imported,
    queued: result.queued,
    skipped: result.skipped,
    prunedAsMismatch: result.prunedAsMismatch,
  });
}
