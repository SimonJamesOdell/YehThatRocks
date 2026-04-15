import { cookies } from "next/headers";

import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { verifyToken } from "@/lib/auth-jwt";
import { prisma } from "@/lib/db";

type PrismaWithVerifiedUser = typeof prisma & {
  user: {
    findUnique: (args: {
      where: { id: number };
      select: { id: true; email: true; emailVerifiedAt: true; screenName: true; avatarUrl: true; bio: true; location: true };
    }) => Promise<{
      id: number;
      email: string | null;
      emailVerifiedAt: Date | null;
      screenName: string | null;
      avatarUrl: string | null;
      bio: string | null;
      location: string | null;
    } | null>;
  };
};

async function getAuthenticatedUserByAccessToken(accessToken?: string | null) {
  if (!accessToken) {
    return null;
  }

  try {
    const payload = await verifyToken(accessToken, "access");
    return await (prisma as PrismaWithVerifiedUser).user.findUnique({
      where: { id: payload.uid },
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
  } catch {
    return null;
  }
}

export async function getCurrentAuthenticatedUserByAccessToken(accessToken?: string | null) {
  return getAuthenticatedUserByAccessToken(accessToken);
}

export async function getCurrentAuthenticatedUser() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  return getAuthenticatedUserByAccessToken(accessToken);
}
