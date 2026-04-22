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

function getAuthCookieOptionsWithoutDomain(maxAge: number) {
  return {
    httpOnly: true as const,
    sameSite: "strict" as const,
    secure: isSecureCookie(),
    path: "/",
    maxAge,
  };
}

type CookieClearOptions = {
  httpOnly: boolean;
  sameSite: "strict";
  secure: boolean;
  path: string;
  maxAge: number;
  domain?: string;
};

/**
 * Manually serializes a Set-Cookie header string for clearing a named cookie.
 * Used when we need to append *additional* Set-Cookie entries for the same
 * cookie name without clobbering ones already registered via response.cookies.
 */
function serializeExpiryCookie(name: string, options: CookieClearOptions): string | null {
  try {
    const parts: string[] = [`${name}=`];
    parts.push("Max-Age=0");
    parts.push(`Path=${options.path}`);

    if (options.domain) {
      parts.push(`Domain=${options.domain}`);
    }

    if (options.sameSite) {
      parts.push(`SameSite=${options.sameSite.charAt(0).toUpperCase()}${options.sameSite.slice(1)}`);
    }

    if (options.secure) {
      parts.push("Secure");
    }

    if (options.httpOnly) {
      parts.push("HttpOnly");
    }

    return parts.join("; ");
  } catch {
    return null;
  }
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
  // Clear the domain-scoped variant (how cookies are set in production).
  response.cookies.set(ACCESS_TOKEN_COOKIE, "", getAuthCookieOptions(0));
  response.cookies.set(REFRESH_TOKEN_COOKIE, "", getAuthCookieOptions(0));

  // Also clear host-only variants in case APP_URL changed or was absent when
  // the cookie was originally issued. We must use headers.append (not a second
  // response.cookies.set call) because ResponseCookies is keyed by name —
  // a second set() call for the same name would silently overwrite the first,
  // leaving only the host-only clear and never deleting the domain cookie.
  const accessExpiry = serializeExpiryCookie(ACCESS_TOKEN_COOKIE, getAuthCookieOptionsWithoutDomain(0));
  const refreshExpiry = serializeExpiryCookie(REFRESH_TOKEN_COOKIE, getAuthCookieOptionsWithoutDomain(0));

  if (accessExpiry) {
    response.headers.append("Set-Cookie", accessExpiry);
  }

  if (refreshExpiry) {
    response.headers.append("Set-Cookie", refreshExpiry);
  }
}

export function readAuthCookies(request: NextRequest) {
  return {
    accessToken: request.cookies.get(ACCESS_TOKEN_COOKIE)?.value,
    refreshToken: request.cookies.get(REFRESH_TOKEN_COOKIE)?.value,
  };
}
