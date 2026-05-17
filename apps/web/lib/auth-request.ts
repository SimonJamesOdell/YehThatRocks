import { NextRequest, NextResponse } from "next/server";

import { readAuthCookies } from "@/lib/auth-cookies";
import { isTokenValidationError, verifyToken } from "@/lib/auth-jwt";

export type AuthContext = {
  userId: number | null; // Allow null for guest users
  email?: string; // Optional for guest users
  isGuest?: boolean; // Indicates if the user is a guest
};

function createUnauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function createAuthUnavailableResponse() {
  return NextResponse.json(
    {
      error: "Auth verification unavailable",
      code: "AUTH_UNAVAILABLE",
    },
    { status: 503 },
  );
}

export async function requireApiAuth(request: NextRequest): Promise<
  | { ok: true; auth: AuthContext }
  | { ok: false; response: NextResponse }
> {
  const { accessToken } = readAuthCookies(request);

  if (!accessToken) {
    // Allow unauthenticated users to watch videos
    return { ok: true, auth: { userId: null, isGuest: true } };
  }

  try {
    const payload = await verifyToken(accessToken, "access");

    return {
      ok: true,
      auth: {
        userId: payload.uid,
        email: payload.email,
        isGuest: payload.isGuest,
      },
    };
  } catch (error) {
    return {
      ok: false,
      response: isTokenValidationError(error)
        ? createUnauthorizedResponse()
        : createAuthUnavailableResponse(),
    };
  }
}

export async function getOptionalApiAuth(request: NextRequest): Promise<AuthContext | null> {
  const { accessToken } = readAuthCookies(request);

  if (!accessToken) {
    return null;
  }

  try {
    const payload = await verifyToken(accessToken, "access");
    return {
      userId: payload.uid,
      email: payload.email,
      isGuest: payload.isGuest,
    };
  } catch {
    return null;
  }
}
