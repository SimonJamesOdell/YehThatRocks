import { NextRequest, NextResponse } from "next/server";

import { getRequestMetadata, recordAuthAudit } from "@/lib/auth-audit";
import { sendVerificationEmail } from "@/lib/auth-email";
import { requireApiAuth } from "@/lib/auth-request";
import { createEmailVerificationToken } from "@/lib/auth-token-records";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import type { PrismaWithVerificationEmailUser } from "@/lib/prisma-types";

const HTTP_FORBIDDEN = 403;

export async function POST(request: NextRequest) {
  const requestMeta = getRequestMetadata(request.headers);
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const userId = authResult.auth.userId;

  if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Authentication context is invalid." }, { status: HTTP_FORBIDDEN });
  }

  const user = await (prisma as PrismaWithVerificationEmailUser).user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, emailVerifiedAt: true },
  });

  if (!user?.email) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (user.emailVerifiedAt) {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  const token = await createEmailVerificationToken(user.id);
  await sendVerificationEmail(user.email, token);
  await recordAuthAudit({ action: "verify-email", success: true, userId: user.id, email: user.email, detail: "Verification email sent", ...requestMeta });

  return NextResponse.json({ ok: true });
}
