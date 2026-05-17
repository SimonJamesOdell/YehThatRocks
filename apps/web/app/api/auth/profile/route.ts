import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuth } from "@/lib/auth-request";
import { isScreenNameTaken, normalizeScreenName } from "@/lib/auth-screen-name";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import type { PrismaWithProfileUser } from "@/lib/prisma-types";
import { parseRequestJson } from "@/lib/request-json";
import { clearServerAuthStateCacheForUserId } from "@/lib/server-auth";

const HTTP_FORBIDDEN = 403;

const profileSchema = z.object({
  screenName: z.string().trim().min(2).max(80),
  bio: z.string().trim().max(1200),
  location: z.string().trim().max(120),
});

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const userId = authResult.auth.userId;

  if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Authentication context is invalid." }, { status: HTTP_FORBIDDEN });
  }

  const user = await (prisma as PrismaWithProfileUser).user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      emailVerifiedAt: true,
      screenName: true,
      avatarUrl: true,
      bio: true,
      location: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      screenName: user.screenName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      location: user.location,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const userId = authResult.auth.userId;

  if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Authentication context is invalid." }, { status: HTTP_FORBIDDEN });
  }

  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const bodyResult = await parseRequestJson(request);

  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = profileSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const screenName = normalizeScreenName(parsed.data.screenName);

  if (await isScreenNameTaken(screenName, userId)) {
    return NextResponse.json({ error: "Screen name is already taken" }, { status: 409 });
  }

  const refreshedUser = await (prisma as PrismaWithProfileUser).user.update({
    where: { id: userId },
    data: {
      screenName,
      bio: parsed.data.bio.length > 0 ? parsed.data.bio : null,
      location: parsed.data.location.length > 0 ? parsed.data.location : null,
    },
    select: {
      id: true,
      email: true,
      emailVerifiedAt: true,
      screenName: true,
      avatarUrl: true,
      bio: true,
      location: true,
    },
  });

  clearServerAuthStateCacheForUserId(refreshedUser.id);

  return NextResponse.json({
    ok: true,
    user: {
      id: refreshedUser.id,
      email: refreshedUser.email,
      emailVerifiedAt: refreshedUser.emailVerifiedAt,
      screenName: refreshedUser.screenName,
      avatarUrl: refreshedUser.avatarUrl,
      bio: refreshedUser.bio,
      location: refreshedUser.location,
    },
  });
}
