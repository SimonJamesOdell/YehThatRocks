import { NextRequest, NextResponse } from "next/server";

import { upgradeToEmailSchema } from "@/lib/api-schemas";
import { getRequestMetadata, recordAuthAudit } from "@/lib/auth-audit";
import { sendVerificationEmail } from "@/lib/auth-email";
import { createEmailVerificationToken } from "@/lib/auth-token-records";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { parseRequestJson } from "@/lib/request-json";
import { requireApiAuth } from "@/lib/auth-request";

export async function POST(request: NextRequest) {
  const requestMeta = getRequestMetadata(request.headers);
  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const authResult = await requireApiAuth(request);
  if (!authResult.ok) {
    return authResult.response;
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

    const parsed = upgradeToEmailSchema.safeParse(bodyResult.data);

    if (!parsed.success) {
      await recordAuthAudit({
        action: "upgrade",
        success: false,
        userId: authResult.auth.userId,
        detail: "Invalid upgrade payload",
        ...requestMeta,
      });
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase().trim();

    // Verify the user is anonymous
    const user = await prisma.user.findUnique({
      where: { id: authResult.auth.userId },
      select: { id: true, email: true },
    });

    if (!user) {
      await recordAuthAudit({
        action: "upgrade",
        success: false,
        userId: authResult.auth.userId,
        detail: "User not found",
        ...requestMeta,
      });
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.email) {
      await recordAuthAudit({
        action: "upgrade",
        success: false,
        userId: authResult.auth.userId,
        detail: "Account already has email and is not anonymous",
        ...requestMeta,
      });
      return NextResponse.json({ error: "Account is not anonymous" }, { status: 400 });
    }

    // Check if email is already in use
    const existing = await prisma.user.findFirst({
      where: {
        email,
      },
      select: { id: true },
    });

    if (existing) {
      await recordAuthAudit({
        action: "upgrade",
        success: false,
        userId: authResult.auth.userId,
        email,
        detail: "Email already registered",
        ...requestMeta,
      });
      return NextResponse.json({ error: "Email is already registered" }, { status: 409 });
    }

    // Upgrade the account
    const upgraded = await prisma.user.update({
      where: { id: authResult.auth.userId },
      data: {
        email,
      },
      select: {
        id: true,
        email: true,
        screenName: true,
      },
    });

    // Send verification email
    try {
      const verificationToken = await createEmailVerificationToken(upgraded.id);
      await sendVerificationEmail(upgraded.email ?? email, verificationToken);
    } catch (error) {
      console.error("[auth-upgrade] verification dispatch failed", error);
      // Don't fail the upgrade if email send fails
    }

    await recordAuthAudit({
      action: "upgrade",
      success: true,
      userId: upgraded.id,
      email: upgraded.email,
      detail: "Account upgraded to email",
      ...requestMeta,
    });

    return NextResponse.json(
      {
        ok: true,
        user: upgraded,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[auth-upgrade] unhandled error", error);

    const message = error instanceof Error ? error.message : "Unknown error";

    try {
      await recordAuthAudit({
        action: "upgrade",
        success: false,
        userId: authResult.auth.userId,
        detail: `Upgrade failed: ${message}`,
        ...requestMeta,
      });
    } catch (auditError) {
      console.error("[auth-upgrade] failed to write auth audit", auditError);
    }

    return NextResponse.json(
      {
        error: process.env.NODE_ENV === "development" ? message : "Failed to upgrade account",
      },
      { status: 500 },
    );
  }
}
