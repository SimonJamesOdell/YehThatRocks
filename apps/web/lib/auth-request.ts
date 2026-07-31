import { NextRequest, NextResponse } from "next/server";

import { readAuthCookies } from "@/lib/auth-cookies";
import { verifyToken } from "@/lib/auth-jwt";

export type AuthContext = {
  userId: number | null; // Allow null for guest users
  email?: string; // Optional for guest users
  isGuest?: boolean; // Indicates if the user is a guest
};

function createUnauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  } catch {
    // Any failure to verify the token means the request is unauthorized.
    // jwtVerify is a local operation — there is no external auth service that
    // could be temporarily unavailable, so all errors map to 401.
    return { ok: false, response: createUnauthorizedResponse() };
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
