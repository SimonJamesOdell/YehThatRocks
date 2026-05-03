import { NextRequest, NextResponse } from "next/server";

import { registerSchema } from "@/lib/api-schemas";
import { getRequestMetadata, recordAuthAudit } from "@/lib/auth-audit";
import { sendVerificationEmail } from "@/lib/auth-email";
import { setAuthCookies } from "@/lib/auth-cookies";
import { signAccessToken, signRefreshToken } from "@/lib/auth-jwt";
import { hashPassword } from "@/lib/auth-password";
import { handleUnhandledAuthError } from "@/lib/auth-route-error";
import { isScreenNameTaken, normalizeScreenName } from "@/lib/auth-screen-name";
import { createRefreshSession } from "@/lib/auth-sessions";
import { createEmailVerificationToken } from "@/lib/auth-token-records";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { parseRequestJson } from "@/lib/request-json";

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

  try {
    const bodyResult = await parseRequestJson(request);

    if (!bodyResult.ok) {
      return bodyResult.response;
    }

    const parsed = registerSchema.safeParse(bodyResult.data);

    if (!parsed.success) {
      await recordAuthAudit({
        action: "register",
        success: false,
        detail: "Invalid register payload",
        ...requestMeta,
      });
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const rateLimited = rateLimitOrResponse(request, `auth:register:${email}`, 6, 30 * 60 * 1000);

    if (rateLimited) {
      await recordAuthAudit({
        action: "register",
        success: false,
        email,
        detail: "Register rate limited",
        ...requestMeta,
      });
      return rateLimited;
    }

    const existing = await prisma.user.findFirst({
      where: {
        email,
      },
      select: { id: true },
    });

    if (existing) {
      await recordAuthAudit({
        action: "register",
        success: false,
        email,
        detail: "Email already registered",
        ...requestMeta,
      });
      return NextResponse.json({ error: "Email is already registered" }, { status: 409 });
    }

    const screenName = normalizeScreenName(parsed.data.screenName);

    if (await isScreenNameTaken(screenName)) {
      await recordAuthAudit({
        action: "register",
        success: false,
        email,
        detail: `Screen name already registered: ${screenName}`,
        ...requestMeta,
      });
      return NextResponse.json({ error: "Screen name is already taken" }, { status: 409 });
    }

    const passwordHash = await hashPassword(parsed.data.password);

    const user = await prisma.user.create({
      data: {
        email,
        screenName,
        passwordHash,
      },
      select: {
        id: true,
        email: true,
        screenName: true,
      },
    });

    const accessToken = await signAccessToken(user.id, user.email ?? email);
    const refreshToken = await signRefreshToken(user.id, user.email ?? email, parsed.data.remember);
    await createRefreshSession(user.id, refreshToken, parsed.data.remember);

    // Verification delivery should not block successful registration.
    try {
      const verificationToken = await createEmailVerificationToken(user.id);
      await sendVerificationEmail(user.email ?? email, verificationToken);
    } catch (error) {
      console.error("[auth-register] verification dispatch failed", error);
    }

    const response = NextResponse.json(
      {
        user,
        ok: true,
      },
      { status: 201 },
    );

    setAuthCookies(response, accessToken, refreshToken, parsed.data.remember);
    await recordAuthAudit({
      action: "register",
      success: true,
      email: user.email,
      userId: user.id,
      detail: "Registration successful",
      ...requestMeta,
    });
    return response;
  } catch (error) {
    return handleUnhandledAuthError(error, requestMeta, "register", {
      logMessage: "[auth-register] unhandled register error",
      auditFailureLogMessage: "[auth-register] failed to write auth audit",
      unknownMessage: "Unknown registration error",
      auditDetail: (message) => `Unhandled register error: ${message}`,
      response: (message) => ({
        status: 500,
        error:
          process.env.NODE_ENV === "development"
            ? `Registration failed: ${message}`
            : "Internal server error",
      }),
    });
  }
}
