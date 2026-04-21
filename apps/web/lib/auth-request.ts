import { NextRequest, NextResponse } from "next/server";

import { readAuthCookies } from "@/lib/auth-cookies";
import { isTokenValidationError, verifyToken } from "@/lib/auth-jwt";

export type AuthContext = {
  userId: number;
  email: string;
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
    return {
      ok: false,
      response: createUnauthorizedResponse(),
    };
  }

  try {
    const payload = await verifyToken(accessToken, "access");

    return {
      ok: true,
      auth: {
        userId: payload.uid,
        email: payload.email,
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
    };
  } catch {
    return null;
  }
}
