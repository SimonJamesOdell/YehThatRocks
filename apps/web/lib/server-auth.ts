import { cookies } from "next/headers";

import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { isTokenValidationError, verifyToken } from "@/lib/auth-jwt";
import { withSoftTimeout } from "@/lib/catalog-data-utils";
import { prisma } from "@/lib/db";
import { readPositiveIntEnv } from "@/lib/number-utils";
import type { PrismaWithVerifiedUser, VerifiedUser } from "@/lib/prisma-types";
import {
  getCacheEntry,
  pruneCacheToMaxEntries,
  pruneExpiringCacheEntries,
  setCacheEntry,
  type ServerAuthCacheState,
} from "@/lib/server-auth-cache";

const SERVER_AUTH_LOOKUP_TIMEOUT_MS = 2_500;
const SERVER_AUTH_STATE_CACHE_TTL_MS = readPositiveIntEnv(
  "SERVER_AUTH_CACHE_TTL_MS",
  5_000,
  500,
  30_000,
);
const SERVER_AUTH_STATE_CACHE_MAX_ENTRIES = readPositiveIntEnv(
  "SERVER_AUTH_CACHE_MAX_ENTRIES",
  1_000,
  100,
  10_000,
);

const serverAuthStateCache = new Map<string, ServerAuthCacheState<ServerAuthState>>();
const serverAuthInFlight = new Map<string, Promise<ServerAuthState>>();
const cachedTokenKeysByUserId = new Map<number, Set<string>>();

function trackCachedTokenForUser(userId: number, tokenKey: string) {
  const existing = cachedTokenKeysByUserId.get(userId);
  if (existing) {
    existing.add(tokenKey);
    return;
  }

  cachedTokenKeysByUserId.set(userId, new Set([tokenKey]));
}

function cleanupTokenUserIndex(tokenKey: string) {
  for (const [userId, tokenKeys] of cachedTokenKeysByUserId.entries()) {
    if (!tokenKeys.has(tokenKey)) {
      continue;
    }

    tokenKeys.delete(tokenKey);
    if (tokenKeys.size === 0) {
      cachedTokenKeysByUserId.delete(userId);
    }
  }
}

function pruneServerAuthStateCache(now = Date.now()) {
  const beforeKeys = new Set(serverAuthStateCache.keys());
  pruneExpiringCacheEntries(serverAuthStateCache, now);
  for (const tokenKey of beforeKeys) {
    if (!serverAuthStateCache.has(tokenKey)) {
      cleanupTokenUserIndex(tokenKey);
    }
  }

  if (serverAuthStateCache.size <= SERVER_AUTH_STATE_CACHE_MAX_ENTRIES) {
    return;
  }

  const keysBeforePrune = new Set(serverAuthStateCache.keys());
  pruneCacheToMaxEntries(serverAuthStateCache, SERVER_AUTH_STATE_CACHE_MAX_ENTRIES);
  for (const tokenKey of keysBeforePrune) {
    if (!serverAuthStateCache.has(tokenKey)) {
      cleanupTokenUserIndex(tokenKey);
    }
  }
}

export function clearServerAuthStateCacheForUserId(userId: number) {
  const tokenKeys = cachedTokenKeysByUserId.get(userId);
  if (!tokenKeys) {
    return;
  }

  for (const tokenKey of tokenKeys) {
    serverAuthStateCache.delete(tokenKey);
    serverAuthInFlight.delete(tokenKey);
  }

  cachedTokenKeysByUserId.delete(userId);
}

export type ServerAuthState =
  | { status: "authenticated"; user: VerifiedUser }
  | { status: "unauthenticated" }
  | { status: "unavailable"; message: string };

async function resolveAuthenticatedUserByAccessToken(accessToken?: string | null): Promise<ServerAuthState> {
  if (!accessToken) {
    return { status: "unauthenticated" };
  }

  pruneServerAuthStateCache();

  const cached = getCacheEntry(serverAuthStateCache, accessToken);
  if (cached) {
    return cached;
  }

  const inFlight = serverAuthInFlight.get(accessToken);
  if (inFlight) {
    return inFlight;
  }

  const resolvePromise = (async (): Promise<ServerAuthState> => {
    try {
      const payload = await verifyToken(accessToken, "access");
      try {
        const user = await withSoftTimeout(
          `server-auth:user:${payload.uid}`,
          SERVER_AUTH_LOOKUP_TIMEOUT_MS,
          () => (prisma as PrismaWithVerifiedUser).user.findUnique({
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
          }),
        );

        const result = user
          ? ({ status: "authenticated", user } as const)
          : ({ status: "unauthenticated" } as const);

        setCacheEntry(
          serverAuthStateCache,
          accessToken,
          result,
          SERVER_AUTH_STATE_CACHE_TTL_MS,
          SERVER_AUTH_STATE_CACHE_MAX_ENTRIES,
        );

        if (result.status === "authenticated") {
          trackCachedTokenForUser(result.user.id, accessToken);
        }

        return result;
      } catch {
        return {
          status: "unavailable",
          message: "The auth server is not responding, so your authorization status cannot currently be confirmed.",
        };
      }
    } catch (error) {
      if (isTokenValidationError(error)) {
        const result = { status: "unauthenticated" } as const;
        setCacheEntry(
          serverAuthStateCache,
          accessToken,
          result,
          SERVER_AUTH_STATE_CACHE_TTL_MS,
          SERVER_AUTH_STATE_CACHE_MAX_ENTRIES,
        );
        return result;
      }

      return {
        status: "unavailable",
        message: "The auth server is not responding, so your authorization status cannot currently be confirmed.",
      };
    }
  })();

  serverAuthInFlight.set(accessToken, resolvePromise);

  try {
    return await resolvePromise;
  } finally {
    if (serverAuthInFlight.get(accessToken) === resolvePromise) {
      serverAuthInFlight.delete(accessToken);
    }
    pruneServerAuthStateCache();
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
