import { NextRequest, NextResponse } from "next/server";

import { loginSchema } from "@/lib/api-schemas";
import { getRequestMetadata, recordAuthAudit } from "@/lib/auth-audit";
import { setAuthCookies } from "@/lib/auth-cookies";
import { signAccessToken, signRefreshToken } from "@/lib/auth-jwt";
import { verifyPassword } from "@/lib/auth-password";
import { handleUnhandledAuthError, isTransientDatabaseError } from "@/lib/auth-route-error";
import { createRefreshSession } from "@/lib/auth-sessions";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { parseRequestJson } from "@/lib/request-json";

function normalizeLoginSecret(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n");
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

  try {
    const bodyResult = await parseRequestJson(request);

    if (!bodyResult.ok) {
      return bodyResult.response;
    }

    const parsed = loginSchema.safeParse(bodyResult.data);

    if (!parsed.success) {
      await recordAuthAudit({
        action: "login",
        success: false,
        detail: "Invalid login payload",
        ...requestMeta,
      });
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const loginIdentifier = parsed.data.email.trim();
    const normalizedEmail = loginIdentifier.toLowerCase();
    const rateLimited = rateLimitOrResponse(request, `auth:login:${normalizedEmail}`, 10, 15 * 60 * 1000);

    if (rateLimited) {
      await recordAuthAudit({
        action: "login",
        success: false,
        email: normalizedEmail,
        detail: "Login rate limited",
        ...requestMeta,
      });
      return rateLimited;
    }

    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { screenName: loginIdentifier },
        ],
      },
      select: {
        id: true,
        email: true,
        screenName: true,
        passwordHash: true,
      },
    });

    if (!user) {
      await recordAuthAudit({
        action: "login",
        success: false,
        email: normalizedEmail,
        detail: "User not found",
        ...requestMeta,
      });
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const storedHash = user.passwordHash;

    if (!storedHash) {
      await recordAuthAudit({
        action: "login",
        success: false,
        email: user.email ?? normalizedEmail,
        userId: user.id,
        detail: "Password login unavailable",
        ...requestMeta,
      });
      return NextResponse.json({ error: "Password login is not enabled for this account" }, { status: 401 });
    }

    const candidatePasswords = new Set<string>();
    const rawPassword = parsed.data.password;
    const normalizedPassword = normalizeLoginSecret(rawPassword);
    const trimmedPassword = rawPassword.trim();
    const trimmedNormalizedPassword = normalizedPassword.trim();

    candidatePasswords.add(rawPassword);
    candidatePasswords.add(normalizedPassword);
    if (trimmedPassword.length > 0) {
      candidatePasswords.add(trimmedPassword);
    }
    if (trimmedNormalizedPassword.length > 0) {
      candidatePasswords.add(trimmedNormalizedPassword);
    }

    let isValid = false;
    for (const candidatePassword of candidatePasswords) {
      if (await verifyPassword(candidatePassword, storedHash)) {
        isValid = true;
        break;
      }
    }

    if (!isValid) {
      await recordAuthAudit({
        action: "login",
        success: false,
        email: user.email ?? normalizedEmail,
        userId: user.id,
        detail: "Invalid password",
        ...requestMeta,
      });
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const accessToken = await signAccessToken(user.id, user.email ?? normalizedEmail);
    const refreshToken = await signRefreshToken(user.id, user.email ?? normalizedEmail, parsed.data.remember);
    await createRefreshSession(user.id, refreshToken, parsed.data.remember);

    const response = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        screenName: user.screenName,
      },
    });

    setAuthCookies(response, accessToken, refreshToken, parsed.data.remember);
    await recordAuthAudit({
      action: "login",
      success: true,
      email: user.email,
      userId: user.id,
      detail: "Login successful",
      ...requestMeta,
    });
    return response;
  } catch (error) {
    return handleUnhandledAuthError(error, requestMeta, "login", {
      logMessage: "[auth-login] unhandled login error",
      auditFailureLogMessage: "[auth-login] failed to write auth audit",
      unknownMessage: "Unknown login error",
      auditDetail: (message) => `Unhandled login error: ${message}`,
      response: (message, unknownError) => {
        const transientDatabaseError = isTransientDatabaseError(unknownError);
        return {
          status: transientDatabaseError ? 503 : 500,
          error:
            process.env.NODE_ENV === "development"
              ? transientDatabaseError
                ? "Login unavailable: database connection pool is exhausted"
                : `Login failed: ${message}`
              : transientDatabaseError
                ? "Service unavailable"
                : "Internal server error",
        };
      },
    });
  }
}
