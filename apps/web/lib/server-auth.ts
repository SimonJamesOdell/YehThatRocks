import { cookies } from "next/headers";

import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { isTokenValidationError, verifyToken } from "@/lib/auth-jwt";
import { prisma } from "@/lib/db";

type VerifiedUser = {
  id: number;
  email: string | null;
  emailVerifiedAt: Date | null;
  screenName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
};

type PrismaWithVerifiedUser = typeof prisma & {
  user: {
    findUnique: (args: {
      where: { id: number };
      select: { id: true; email: true; emailVerifiedAt: true; screenName: true; avatarUrl: true; bio: true; location: true };
    }) => Promise<VerifiedUser | null>;
  };
};

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

export async function getCurrentAuthenticatedUserByAccessToken(accessToken?: string | null) {
  const authState = await resolveAuthenticatedUserByAccessToken(accessToken);
  return authState.status === "authenticated" ? authState.user : null;
}

export async function getCurrentAuthenticatedUserAuthStateByAccessToken(accessToken?: string | null) {
  return resolveAuthenticatedUserByAccessToken(accessToken);
}

export async function getCurrentAuthenticatedUser() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  const authState = await resolveAuthenticatedUserByAccessToken(accessToken);
  return authState.status === "authenticated" ? authState.user : null;
}

export async function getCurrentAuthenticatedUserAuthState() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  return resolveAuthenticatedUserByAccessToken(accessToken);
}
