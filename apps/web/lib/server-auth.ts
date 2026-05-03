import { cookies } from "next/headers";

import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { isTokenValidationError, verifyToken } from "@/lib/auth-jwt";
import { prisma } from "@/lib/db";
import type { PrismaWithVerifiedUser, VerifiedUser } from "@/lib/prisma-types";

export type ServerAuthState =
  | { status: "authenticated"; user: VerifiedUser }
  | { status: "unauthenticated" }
  | { status: "unavailable"; message: string };

async function resolveAuthenticatedUserByAccessToken(accessToken?: string | null): Promise<ServerAuthState> {
  if (!accessToken) {
    return { status: "unauthenticated" };
  }

  try {
    const payload = await verifyToken(accessToken, "access");
    try {
      const user = await (prisma as PrismaWithVerifiedUser).user.findUnique({
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

      if (!user) {
        return { status: "unauthenticated" };
      }

      return { status: "authenticated", user };
    } catch {
      return {
        status: "unavailable",
        message: "The auth server is not responding, so your authorization status cannot currently be confirmed.",
      };
    }
  } catch (error) {
    if (isTokenValidationError(error)) {
      return { status: "unauthenticated" };
    }

    return {
      status: "unavailable",
      message: "The auth server is not responding, so your authorization status cannot currently be confirmed.",
    };
  }
}

export async function getCurrentAuthenticatedUserAuthStateByAccessToken(accessToken?: string | null) {
  return resolveAuthenticatedUserByAccessToken(accessToken);
}

export async function getCurrentAuthenticatedUserAuthState() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  return resolveAuthenticatedUserByAccessToken(accessToken);
}
