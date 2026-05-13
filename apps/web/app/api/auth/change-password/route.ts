import { NextRequest, NextResponse } from "next/server";

import { getRequestMetadata, recordAuthAudit } from "@/lib/auth-audit";
import { withAuthAndBody } from "@/lib/api-route-pipeline";
import { hashPassword, verifyPassword } from "@/lib/auth-password";
import { revokeUserRefreshSessions } from "@/lib/auth-sessions";
import { prisma } from "@/lib/db";
import { z } from "zod";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(8).max(128),
});

export async function POST(request: NextRequest) {
  const requestMeta = getRequestMetadata(request.headers);
  const result = await withAuthAndBody(request, changePasswordSchema, { authMode: "user" });

  if (!result.ok) {
    return result.response;
  }

  const user = await prisma.user.findUnique({
    where: { id: result.auth.userId },
    select: {
      id: true,
      email: true,
      passwordHash: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const storedHash = user.passwordHash;

  if (!storedHash) {
    return NextResponse.json({ error: "Password login is not enabled for this account" }, { status: 400 });
  }

  const isValid = await verifyPassword(parsed.data.currentPassword, storedHash);
  const isValid = await verifyPassword(result.data.currentPassword, storedHash);

  if (!isValid) {
    await recordAuthAudit({
      action: "reset-password",
      success: false,
      userId: user.id,
      email: user.email,
      detail: "Change-password current password mismatch",
      ...requestMeta,
    });
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  const passwordHash = await hashPassword(result.data.newPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  await revokeUserRefreshSessions(user.id);

  await recordAuthAudit({
    action: "reset-password",
    success: true,
    userId: user.id,
    email: user.email,
    detail: "In-session password change successful",
    ...requestMeta,
  });

  return NextResponse.json({ ok: true });
}