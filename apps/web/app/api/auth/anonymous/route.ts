import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

import { getRequestMetadata, recordAuthAudit } from "@/lib/auth-audit";
import { buildAnonymousScreenNameSuggestion } from "@/lib/anonymous-screen-name";
import { setAuthCookies } from "@/lib/auth-cookies";
import { signAccessToken, signRefreshToken } from "@/lib/auth-jwt";
import { hashPassword } from "@/lib/auth-password";
import { SCREEN_NAME_MAX_LENGTH, SCREEN_NAME_MIN_LENGTH, isScreenNameTaken, normalizeScreenName } from "@/lib/auth-screen-name";
import { createRefreshSession } from "@/lib/auth-sessions";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { parseRequestJson } from "@/lib/request-json";
import { rateLimitOrResponse, rateLimitSharedOrResponse } from "@/lib/rate-limit";

type AnonymousRequestBody = {
  screenName?: string;
};

const ANONYMOUS_CHECK_LIMIT_PER_IP = 90;
const ANONYMOUS_CHECK_WINDOW_MS = 5 * 60 * 1000;
const ANONYMOUS_CHECK_LIMIT_GLOBAL = 2000;
const ANONYMOUS_CREATE_LIMIT_PER_IP = 6;
const ANONYMOUS_CREATE_WINDOW_MS = 30 * 60 * 1000;
const ANONYMOUS_CREATE_LIMIT_GLOBAL = 240;
const ANONYMOUS_CREATE_GLOBAL_WINDOW_MS = 10 * 60 * 1000;

/**
 * Generates a secure random string suitable for credentials.
 * Uses alphanumeric characters to make it easy to copy/paste.
 */
function generateSecureCredential(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

export async function GET(request: NextRequest) {
  const checkRateLimited = rateLimitOrResponse(
    request,
    "auth:anonymous:availability-check",
    ANONYMOUS_CHECK_LIMIT_PER_IP,
    ANONYMOUS_CHECK_WINDOW_MS,
  );

  if (checkRateLimited) {
    return checkRateLimited;
  }

  const checkRateLimitedShared = rateLimitSharedOrResponse(
    "auth:anonymous:availability-check:global",
    ANONYMOUS_CHECK_LIMIT_GLOBAL,
    ANONYMOUS_CHECK_WINDOW_MS,
  );

  if (checkRateLimitedShared) {
    return checkRateLimitedShared;
  }

  const screenName = normalizeScreenName(request.nextUrl.searchParams.get("screenName") ?? "");

  if (!screenName) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const suggestion = buildAnonymousScreenNameSuggestion();

      if (!(await isScreenNameTaken(suggestion))) {
        return NextResponse.json({
          ok: true,
          available: true,
          screenName: suggestion,
        });
      }
    }

    return NextResponse.json(
      {
        ok: false,
        error: "Could not generate an available screen name right now.",
        available: false,
      },
      { status: 503 },
    );
  }

  if (screenName.length < SCREEN_NAME_MIN_LENGTH || screenName.length > SCREEN_NAME_MAX_LENGTH) {
    return NextResponse.json(
      {
        ok: false,
        error: `Screen name must be between ${SCREEN_NAME_MIN_LENGTH} and ${SCREEN_NAME_MAX_LENGTH} characters.`,
        available: false,
      },
      { status: 400 },
    );
  }

  const taken = await isScreenNameTaken(screenName);

  return NextResponse.json({
    ok: true,
    available: !taken,
    screenName,
  });
}

export async function POST(request: NextRequest) {
  const requestMeta = getRequestMetadata(request.headers);
  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "development"
            ? "DATABASE_URL is not configured"
            : "Service unavailable",
      },
      { status: 503 },
    );
  }

  const createRateLimited = rateLimitOrResponse(
    request,
    "auth:anonymous:create",
    ANONYMOUS_CREATE_LIMIT_PER_IP,
    ANONYMOUS_CREATE_WINDOW_MS,
  );

  if (createRateLimited) {
    await recordAuthAudit({
      action: "register",
      success: false,
      detail: "Anonymous account create rate limited (per-IP)",
      ...requestMeta,
    });
    return createRateLimited;
  }

  const createRateLimitedShared = rateLimitSharedOrResponse(
    "auth:anonymous:create:global",
    ANONYMOUS_CREATE_LIMIT_GLOBAL,
    ANONYMOUS_CREATE_GLOBAL_WINDOW_MS,
  );

  if (createRateLimitedShared) {
    await recordAuthAudit({
      action: "register",
      success: false,
      detail: "Anonymous account create rate limited (global)",
      ...requestMeta,
    });
    return createRateLimitedShared;
  }

  try {
    const bodyResult = await parseRequestJson<AnonymousRequestBody>(request);
    const requestBody = bodyResult.ok ? bodyResult.data : null;
    const username = normalizeScreenName(requestBody?.screenName ?? "");

    if (username.length < SCREEN_NAME_MIN_LENGTH || username.length > SCREEN_NAME_MAX_LENGTH) {
      return NextResponse.json(
        {
          error: `Screen name must be between ${SCREEN_NAME_MIN_LENGTH} and ${SCREEN_NAME_MAX_LENGTH} characters.`,
        },
        { status: 400 },
      );
    }

    if (await isScreenNameTaken(username)) {
      await recordAuthAudit({
        action: "register",
        success: false,
        detail: `Anonymous screen name unavailable: ${username}`,
        ...requestMeta,
      });
      return NextResponse.json({ error: "Screen name is already taken" }, { status: 409 });
    }

    // Generate credentials
    const password = generateSecureCredential(16); // 16-char alphanumeric password
    const passwordHash = await hashPassword(password);

    // Create anonymous user
    const user = await prisma.user.create({
      data: {
        screenName: username,
        passwordHash,
      },
      select: {
        id: true,
        screenName: true,
      },
    });

    // Generate tokens
    const accessToken = await signAccessToken(user.id, "");
    const refreshToken = await signRefreshToken(user.id, "", false);
    await createRefreshSession(user.id, refreshToken, false);

    // Set auth cookies
    const response = NextResponse.json(
      {
        ok: true,
        user: {
          id: user.id,
          screenName: user.screenName,
        },
        credentials: {
          username: user.screenName,
          password,
        },
      },
      { status: 201 },
    );

    setAuthCookies(response, accessToken, refreshToken, false);

    await recordAuthAudit({
      action: "register",
      success: true,
      userId: user.id,
      detail: "Anonymous account created",
      ...requestMeta,
    });

    return response;
  } catch (error) {
    console.error("[auth-anonymous] unhandled error", error);

    const message = error instanceof Error ? error.message : "Unknown error";

    try {
      await recordAuthAudit({
        action: "register",
        success: false,
        detail: `Anonymous account creation failed: ${message}`,
        ...requestMeta,
      });
    } catch (auditError) {
      console.error("[auth-anonymous] failed to write auth audit", auditError);
    }

    return NextResponse.json(
      {
        error: process.env.NODE_ENV === "development" ? message : "Failed to create anonymous account",
      },
      { status: 500 },
    );
  }
}
