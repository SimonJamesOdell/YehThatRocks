import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import { prisma } from "@/lib/db";

const updateSchema = z.object({
  id: z.number().int().positive(),
  genre: z.string().trim().min(1).max(255).optional(),
  thumbnailVideoId: z.string().trim().max(32).nullable().optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireAuthOnly(request);

  if (!auth.ok) {
    return auth.response;
  }

  const categories = await prisma.genreCard.findMany({
    orderBy: { genre: "asc" },
    take: 200,
    select: {
      id: true,
      genre: true,
      thumbnailVideoId: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ categories });
}

export async function PATCH(request: NextRequest) {
  const result = await withAuthAndBody(request, updateSchema);

  if (!result.ok) {
    return result.response;
  }

  const parsed = result.data;

  const updated = await prisma.genreCard.update({
    where: { id: parsed.id },
    data: {
      ...(parsed.genre !== undefined ? { genre: parsed.genre } : {}),
      ...(parsed.thumbnailVideoId !== undefined
        ? { thumbnailVideoId: parsed.thumbnailVideoId || null }
        : {}),
    },
    select: {
      id: true,
      genre: true,
      thumbnailVideoId: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ ok: true, category: updated });
}
