import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import {
  clearArtistCaches,
  clearGenreCaches,
  normalizeArtistKey,
  refreshArtistProjectionForName,
  setCategoryArtistThumbnailPin,
} from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { parseRequestJson } from "@/lib/request-json";

const baseSchema = z.object({
  thumbnailVideoId: z.string().trim().regex(/^[A-Za-z0-9_-]{11}$/),
});

const setArtistThumbnailSchema = baseSchema.extend({
  target: z.literal("artist"),
  artistSlug: z.string().trim().min(1).max(255),
  artistName: z.string().trim().min(1).max(255).optional(),
});

const setCategoryThumbnailSchema = baseSchema.extend({
  target: z.literal("category"),
  genre: z.string().trim().min(1).max(255),
});

const setCategoryArtistThumbnailSchema = baseSchema.extend({
  target: z.literal("category-artist"),
  genre: z.string().trim().min(1).max(255),
  artistName: z.string().trim().min(1).max(255),
});

const updateThumbnailSchema = z.discriminatedUnion("target", [
  setArtistThumbnailSchema,
  setCategoryThumbnailSchema,
  setCategoryArtistThumbnailSchema,
]);

export async function POST(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const csrf = verifySameOrigin(request);
  if (csrf) {
    return csrf;
  }

  const bodyResult = await parseRequestJson<unknown>(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = updateThumbnailSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.target === "artist") {
    const normalizedArtistName = parsed.data.artistName
      ? normalizeArtistKey(parsed.data.artistName)
      : null;

    let result = await prisma.artistStat.updateMany({
      where: {
        OR: [
          { slug: parsed.data.artistSlug },
          ...(normalizedArtistName ? [{ normalizedArtist: normalizedArtistName }] : []),
        ],
      },
      data: { thumbnailVideoId: parsed.data.thumbnailVideoId },
    });

    if (result.count === 0 && parsed.data.artistName) {
      await refreshArtistProjectionForName(parsed.data.artistName).catch(() => undefined);
      result = await prisma.artistStat.updateMany({
        where: {
          OR: [
            { slug: parsed.data.artistSlug },
            { normalizedArtist: normalizeArtistKey(parsed.data.artistName) },
          ],
        },
        data: { thumbnailVideoId: parsed.data.thumbnailVideoId },
      });
    }

    if (result.count === 0) {
      return NextResponse.json({ error: "Artist not found" }, { status: 404 });
    }

    clearArtistCaches();

    return NextResponse.json({
      ok: true,
      target: "artist",
      updatedCount: result.count,
      artistSlug: parsed.data.artistSlug,
      artistName: parsed.data.artistName ?? null,
      thumbnailVideoId: parsed.data.thumbnailVideoId,
    });
  }

  if (parsed.data.target === "category-artist") {
    await setCategoryArtistThumbnailPin(
      parsed.data.genre,
      parsed.data.artistName,
      parsed.data.thumbnailVideoId,
    );

    return NextResponse.json({
      ok: true,
      target: "category-artist",
      genre: parsed.data.genre,
      artistName: parsed.data.artistName,
      thumbnailVideoId: parsed.data.thumbnailVideoId,
    });
  }

  const categoryResult = await prisma.genreCard.updateMany({
    where: { genre: parsed.data.genre },
    data: { thumbnailVideoId: parsed.data.thumbnailVideoId },
  });

  if (categoryResult.count === 0) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }

  clearGenreCaches();

  return NextResponse.json({
    ok: true,
    target: "category",
    updatedCount: categoryResult.count,
    genre: parsed.data.genre,
    thumbnailVideoId: parsed.data.thumbnailVideoId,
  });
}
