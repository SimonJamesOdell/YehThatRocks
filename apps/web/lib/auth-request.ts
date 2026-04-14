import { NextRequest, NextResponse } from "next/server";

import { readAuthCookies } from "@/lib/auth-cookies";
import { verifyToken } from "@/lib/auth-jwt";

export type AuthContext = {
  userId: number;
  email: string;
};

export async function requireApiAuth(request: NextRequest): Promise<
  | { ok: true; auth: AuthContext }
  | { ok: false; response: NextResponse }
> {
  const { accessToken } = readAuthCookies(request);

  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
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
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
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
