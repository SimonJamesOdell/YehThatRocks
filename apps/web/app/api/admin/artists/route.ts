import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthOnly, withAuthAndBody } from "@/lib/api-route-pipeline";
import { prisma } from "@/lib/db";

const updateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(255).optional(),
  country: z.string().trim().max(255).nullable().optional(),
  genre1: z.string().trim().max(255).nullable().optional(),
  genre2: z.string().trim().max(255).nullable().optional(),
  genre3: z.string().trim().max(255).nullable().optional(),
  genre4: z.string().trim().max(255).nullable().optional(),
  genre5: z.string().trim().max(255).nullable().optional(),
  genre6: z.string().trim().max(255).nullable().optional(),
});

type ArtistColumnMap = {
  id: string;
  name: string;
  country: string | null;
  genre1: string | null;
  genre2: string | null;
  genre3: string | null;
  genre4: string | null;
  genre5: string | null;
  genre6: string | null;
};

export async function GET(request: NextRequest) {
  const auth = await requireAuthOnly(request);

  if (!auth.ok) {
    return auth.response;
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();

  const artists = await prisma.artist.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q } },
            { country: { contains: q } },
            { genre1: { contains: q } },
          ],
        }
      : undefined,
    orderBy: { name: "asc" },
    take: 100,
    select: {
      id: true,
      name: true,
      country: true,
      genre1: true,
      genre2: true,
      genre3: true,
      genre4: true,
      genre5: true,
      genre6: true,
    },
  });

  return NextResponse.json({ artists });
}

export async function PATCH(request: NextRequest) {
  const result = await withAuthAndBody(request, updateSchema);

  if (!result.ok) {
    return result.response;
  }

  const parsed = result.data;

  const data: {
    name?: string;
    country?: string | null;
    genre1?: string | null;
    genre2?: string | null;
    genre3?: string | null;
    genre4?: string | null;
    genre5?: string | null;
    genre6?: string | null;
  } = {};

  if (parsed.name !== undefined) data.name = parsed.name;
  if (parsed.country !== undefined) data.country = parsed.country || null;
  if (parsed.genre1 !== undefined) data.genre1 = parsed.genre1 || null;
  if (parsed.genre2 !== undefined) data.genre2 = parsed.genre2 || null;
  if (parsed.genre3 !== undefined) data.genre3 = parsed.genre3 || null;
  if (parsed.genre4 !== undefined) data.genre4 = parsed.genre4 || null;
  if (parsed.genre5 !== undefined) data.genre5 = parsed.genre5 || null;
  if (parsed.genre6 !== undefined) data.genre6 = parsed.genre6 || null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }
  const updated = await prisma.artist
    .update({
      where: { id: parsed.id },
      data,
      select: {
        id: true,
        name: true,
        country: true,
        genre1: true,
        genre2: true,
        genre3: true,
        genre4: true,
        genre5: true,
        genre6: true,
      },
    })
    .catch(() => null);

  if (!updated) {
    return NextResponse.json({ error: "Artist not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, artist: updated });
}
