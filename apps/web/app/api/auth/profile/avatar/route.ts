import { NextRequest, NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth-request";
import { deleteManagedAvatar, storeOptimizedAvatar, validateAvatarUpload } from "@/lib/avatar-storage";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import type { PrismaWithProfileUser } from "@/lib/prisma-types";

export const runtime = "nodejs";

const profileUserSelect = {
  id: true,
  email: true,
  emailVerifiedAt: true,
  screenName: true,
  avatarUrl: true,
  bio: true,
  location: true,
} as const;

function buildProfileResponse(user: {
  id: number;
  email: string | null;
  emailVerifiedAt: Date | null;
  screenName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
}) {
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      screenName: user.screenName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      location: user.location,
    },
  };
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Could not read avatar upload." }, { status: 400 });
  }

  const avatar = formData.get("avatar");
  if (!(avatar instanceof File)) {
    return NextResponse.json({ error: "Please choose an avatar image to upload." }, { status: 400 });
  }

  const validationError = validateAvatarUpload(avatar);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const existingUser = await (prisma as PrismaWithProfileUser).user.findUnique({
    where: { id: authResult.auth.userId },
    select: {
      avatarUrl: true,
    },
  });

  if (!existingUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let nextAvatarUrl: string;
  try {
    nextAvatarUrl = await storeOptimizedAvatar(avatar);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not process that avatar image." },
      { status: 400 },
    );
  }

  try {
    const updatedUser = await (prisma as PrismaWithProfileUser).user.update({
      where: { id: authResult.auth.userId },
      data: {
        avatarUrl: nextAvatarUrl,
      },
      select: profileUserSelect,
    });

    await deleteManagedAvatar(existingUser.avatarUrl);

    return NextResponse.json(buildProfileResponse(updatedUser));
  } catch {
    await deleteManagedAvatar(nextAvatarUrl);
    return NextResponse.json({ error: "Could not save your avatar." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const existingUser = await (prisma as PrismaWithProfileUser).user.findUnique({
    where: { id: authResult.auth.userId },
    select: profileUserSelect,
  });

  if (!existingUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const updatedUser = await (prisma as PrismaWithProfileUser).user.update({
    where: { id: authResult.auth.userId },
    data: {
      avatarUrl: null,
    },
    select: profileUserSelect,
  });

  await deleteManagedAvatar(existingUser.avatarUrl);

  return NextResponse.json(buildProfileResponse(updatedUser));
}