import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_TTL_REMEMBER_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from "@/lib/auth-config";

function isSecureCookie() {
  return process.env.NODE_ENV === "production";
}

function isIpAddress(hostname: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

function getCookieDomain() {
  const appUrl = process.env.APP_URL;

  if (!appUrl) {
    return undefined;
  }

  try {
    const hostname = new URL(appUrl).hostname.trim().toLowerCase();

    if (!hostname || hostname === "localhost" || isIpAddress(hostname)) {
      return undefined;
    }

    return hostname;
  } catch {
    return undefined;
  }
}

function getAuthCookieOptions(maxAge: number) {
  const domain = getCookieDomain();

  return {
    httpOnly: true as const,
    sameSite: "strict" as const,
    secure: isSecureCookie(),
    path: "/",
    maxAge,
    ...(domain ? { domain } : {}),
  };
}

export function setAuthCookies(response: NextResponse, accessToken: string, refreshToken: string, remember: boolean) {
  response.cookies.set(ACCESS_TOKEN_COOKIE, accessToken, getAuthCookieOptions(ACCESS_TOKEN_TTL_SECONDS));

  response.cookies.set(
    REFRESH_TOKEN_COOKIE,
    refreshToken,
    getAuthCookieOptions(remember ? REFRESH_TOKEN_TTL_REMEMBER_SECONDS : REFRESH_TOKEN_TTL_SECONDS),
  );
}

export function clearAuthCookies(response: NextResponse) {
  response.cookies.set(ACCESS_TOKEN_COOKIE, "", getAuthCookieOptions(0));

  response.cookies.set(REFRESH_TOKEN_COOKIE, "", getAuthCookieOptions(0));
}

export function readAuthCookies(request: NextRequest) {
  return {
    accessToken: request.cookies.get(ACCESS_TOKEN_COOKIE)?.value,
    refreshToken: request.cookies.get(REFRESH_TOKEN_COOKIE)?.value,
  };
}
